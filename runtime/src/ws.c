/* maemo:ws -- WebSocket connections with libcurl on the GLib main loop.
   curl does the handshake through the shared multi handle (curlm.c) in
   CONNECT_ONLY=2 mode. After the handshake this module watches the socket
   itself and moves frames with curl_ws_recv and curl_ws_send. JavaScript
   gets the events open, message, error and close. The prelude builds the
   WebSocket class on top of it. */
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>
#include <curl/websockets.h>
#include "mr.h"

#define MAX_MESSAGE (16 * 1024 * 1024) /* bytes of one message */
#define CLOSE_WAIT_MS 5000             /* after our close frame, wait this long for the server's */

enum { CONNECTING, OPEN, CLOSING, CLOSED };

typedef struct {
    guint8 *data;
    gsize len;
    gsize off;      /* the bytes that curl took */
    unsigned flags; /* CURLWS_TEXT, CURLWS_BINARY, CURLWS_PONG or CURLWS_CLOSE */
} Frame;

typedef struct {
    MrCurlOwner owner; /* first: curlm.c finds the connection through it */
    int id;
    CURL *easy;
    JSValue cb;
    struct curl_slist *req_headers;
    gchar *protocol; /* Sec-WebSocket-Protocol of the response, or NULL */
    GPtrArray *offered; /* the protocols that the client offered */
    guint8 control[125]; /* the payload of a ping or close frame that arrives in pieces */
    gsize control_len;
    char error[CURL_ERROR_SIZE];
    int state;
    GIOChannel *channel; /* the socket, after the handshake */
    guint watch;
    GByteArray *message; /* the fragments of the message in progress */
    int message_binary;  /* the kind of that message; -1 when none */
    GQueue *outgoing;    /* Frame* */
    gsize buffered;      /* bytes of send data that curl did not take yet */
    gboolean close_sent;
    gboolean close_received;
    int close_code;
    gchar *close_reason;
    guint close_timer;
    guint handshake_timer; /* the handshake limit; curl does not enforce it in connect-only mode */
    GQueue *pending; /* events for JavaScript, as JSValue pointers */
    guint flush_source;
    gboolean finished; /* the close event is queued; free the connection after the flush */
    gboolean dead;     /* abort() ran: no more events */
} Conn;

static GHashTable *conns; /* id -> Conn */
static int next_id = 1;
static int in_emit; /* above zero while an event runs in JavaScript */

static void frame_free(Frame *f)
{
    g_free(f->data);
    g_free(f);
}

static void drop_pending(Conn *c)
{
    JSValue *ev;
    while ((ev = g_queue_pop_head(c->pending)) != NULL) {
        JS_FreeValue(mr_ctx, *ev);
        g_free(ev);
    }
}

static void clear_watch(Conn *c)
{
    if (c->watch) {
        g_source_remove(c->watch);
        c->watch = 0;
    }
}

static void conn_free(Conn *c)
{
    Frame *f;
    clear_watch(c);
    if (c->close_timer)
        g_source_remove(c->close_timer);
    if (c->handshake_timer)
        g_source_remove(c->handshake_timer);
    if (c->flush_source)
        g_source_remove(c->flush_source);
    drop_pending(c);
    g_queue_free(c->pending);
    while ((f = g_queue_pop_head(c->outgoing)) != NULL)
        frame_free(f);
    g_queue_free(c->outgoing);
    g_hash_table_remove(conns, GINT_TO_POINTER(c->id));
    if (c->channel)
        g_io_channel_unref(c->channel);
    mr_curl_remove(c->easy);
    curl_easy_cleanup(c->easy); /* closes the socket */
    curl_slist_free_all(c->req_headers);
    g_byte_array_free(c->message, TRUE);
    g_free(c->protocol);
    g_ptr_array_foreach(c->offered, (GFunc)g_free, NULL);
    g_ptr_array_free(c->offered, TRUE);
    g_free(c->close_reason);
    JS_FreeValue(mr_ctx, c->cb);
    g_free(c);
}

static JSValue new_event(const char *type)
{
    JSValue ev = JS_NewObject(mr_ctx);
    JS_SetPropertyStr(mr_ctx, ev, "type", JS_NewString(mr_ctx, type));
    return ev;
}

/* Give an event to JavaScript. Takes ownership of ev. */
static void emit(Conn *c, JSValue ev)
{
    JSValue res;
    in_emit++;
    res = mr_call(c->cb, JS_UNDEFINED, 1, (JSValueConst *)&ev);
    in_emit--;
    JS_FreeValue(mr_ctx, res);
    JS_FreeValue(mr_ctx, ev);
}

static void flush_conn(Conn *c)
{
    JSValue *ev;
    while (!c->dead && (ev = g_queue_pop_head(c->pending)) != NULL) {
        emit(c, *ev);
        g_free(ev);
    }
    if (c->dead)
        drop_pending(c);
}

static gboolean on_flush(gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    if (!c)
        return FALSE;
    c->flush_source = 0;
    flush_conn(c);
    /* A dead connection is freed by free_dead. */
    if (c->finished && !c->dead)
        conn_free(c);
    return FALSE;
}

/* Queue an event for JavaScript. The frames are read from a GLib watch and
   the handshake ends in a curlm.c callback; both are outside curl callbacks.
   The queue still keeps JavaScript out of the read loop, so a handler that
   closes the connection cannot free it under the loop. Takes ownership. */
static void emit_later(Conn *c, JSValue ev)
{
    JSValue *copy = g_new(JSValue, 1);
    *copy = ev;
    g_queue_push_tail(c->pending, copy);
    if (!c->flush_source)
        c->flush_source = g_idle_add_full(G_PRIORITY_DEFAULT, on_flush, GINT_TO_POINTER(c->id), NULL);
}

/* Queue the close event. The connection is freed after the flush. */
static void finish(Conn *c, int code, const char *reason, gboolean clean)
{
    JSValue ev;
    if (c->finished)
        return;
    c->finished = TRUE;
    c->state = CLOSED;
    clear_watch(c);
    if (c->close_timer) {
        g_source_remove(c->close_timer);
        c->close_timer = 0;
    }
    if (c->handshake_timer) {
        g_source_remove(c->handshake_timer);
        c->handshake_timer = 0;
    }
    ev = new_event("close");
    JS_SetPropertyStr(mr_ctx, ev, "code", JS_NewInt32(mr_ctx, code));
    JS_SetPropertyStr(mr_ctx, ev, "reason", JS_NewString(mr_ctx, reason ? reason : ""));
    JS_SetPropertyStr(mr_ctx, ev, "wasClean", JS_NewBool(mr_ctx, clean));
    emit_later(c, ev);
}

/* The transport failed. With the close frame of the server already in, the
   close is clean. Otherwise JavaScript gets error, then close with 1006. */
static void fail(Conn *c, const char *message)
{
    JSValue ev;
    if (c->finished)
        return;
    if (c->close_received) {
        finish(c, c->close_code, c->close_reason, TRUE);
        return;
    }
    ev = new_event("error");
    JS_SetPropertyStr(mr_ctx, ev, "message", JS_NewString(mr_ctx, message));
    emit_later(c, ev);
    finish(c, 1006, "", FALSE);
}

static gboolean on_io(GIOChannel *ch, GIOCondition cond, gpointer data);

/* Watch the socket for input, and for output when curl could not take a whole frame. */
static void set_watch(Conn *c, gboolean want_out)
{
    GIOCondition cond = G_IO_IN | G_IO_HUP | G_IO_ERR | (want_out ? G_IO_OUT : 0);
    clear_watch(c);
    c->watch = g_io_add_watch(c->channel, cond, on_io, GINT_TO_POINTER(c->id));
}

static void enqueue(Conn *c, const guint8 *data, gsize len, unsigned flags)
{
    Frame *f = g_new0(Frame, 1);
    f->data = len ? g_memdup(data, len) : NULL;
    f->len = len;
    f->flags = flags;
    g_queue_push_tail(c->outgoing, f);
    if (flags & (CURLWS_TEXT | CURLWS_BINARY))
        c->buffered += len;
}

/* Give the queued frames to curl. curl_ws_send takes a part of a frame when
   the socket is full: then the next call continues the same frame (the
   curl_ws_send documentation, 8.22.0). CURLE_AGAIN means wait for G_IO_OUT. */
static void pump_send(Conn *c)
{
    while (!g_queue_is_empty(c->outgoing)) {
        Frame *f = g_queue_peek_head(c->outgoing);
        size_t sent = 0;
        CURLcode rc = curl_ws_send(c->easy, f->data + f->off, f->len - f->off, &sent, 0, f->flags);
        f->off += sent;
        if (f->flags & (CURLWS_TEXT | CURLWS_BINARY))
            c->buffered -= sent;
        if (rc == CURLE_AGAIN) {
            set_watch(c, TRUE);
            return;
        }
        if (rc != CURLE_OK) {
            fail(c, c->error[0] ? c->error : curl_easy_strerror(rc));
            return;
        }
        if (f->off < f->len)
            continue; /* curl took a part; give it the rest now */
        g_queue_pop_head(c->outgoing);
        frame_free(f);
    }
    if (c->finished)
        return;
    set_watch(c, FALSE);
    if (c->close_sent && c->close_received)
        finish(c, c->close_code, c->close_reason, TRUE);
}

static void send_close_frame(Conn *c, int code, const char *reason)
{
    guint8 buf[125];
    gsize n = 0;
    if (code > 0) {
        gsize rlen = reason ? strlen(reason) : 0;
        if (rlen > 123)
            rlen = 123;
        buf[0] = (guint8)(code >> 8);
        buf[1] = (guint8)(code & 0xff);
        memcpy(buf + 2, reason, rlen);
        n = 2 + rlen;
    }
    enqueue(c, buf, n, CURLWS_CLOSE);
    c->close_sent = TRUE;
}

static gboolean on_close_timeout(gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    if (c) {
        c->close_timer = 0;
        finish(c, 1006, "", FALSE); /* the server did not answer our close frame */
    }
    return FALSE;
}

static void emit_message(Conn *c)
{
    JSValue ev = new_event("message");
    const guint8 *data = c->message->data ? c->message->data : (const guint8 *)"";
    if (c->message_binary)
        JS_SetPropertyStr(mr_ctx, ev, "data", JS_NewArrayBufferCopy(mr_ctx, data, c->message->len));
    else
        JS_SetPropertyStr(mr_ctx, ev, "data", JS_NewStringLen(mr_ctx, (const char *)data, c->message->len));
    emit_later(c, ev);
    g_byte_array_set_size(c->message, 0);
    c->message_binary = -1;
}

/* Read every frame that curl has. Returns FALSE when the connection ended. */
static gboolean pump_recv(Conn *c)
{
    guint8 buf[16384];
    for (;;) {
        size_t n = 0;
        const struct curl_ws_frame *meta = NULL;
        CURLcode rc = curl_ws_recv(c->easy, buf, sizeof buf, &n, &meta);
        if (rc == CURLE_AGAIN)
            return TRUE;
        if (rc != CURLE_OK) {
            fail(c, rc == CURLE_GOT_NOTHING ? "the server closed the connection" : curl_easy_strerror(rc));
            return FALSE;
        }
        if (meta->flags & (CURLWS_CLOSE | CURLWS_PING)) {
            /* curl can return a control frame (125 bytes at most) in pieces.
               Collect the pieces and act once, when the frame is whole. */
            if (c->control_len + n > sizeof c->control) {
                fail(c, "a control frame is too large");
                return FALSE;
            }
            memcpy(c->control + c->control_len, buf, n);
            c->control_len += n;
            if (meta->bytesleft > 0)
                continue;
            n = c->control_len;
            c->control_len = 0;
            if (meta->flags & CURLWS_CLOSE) {
                gboolean has_code = n >= 2;
                c->close_code = has_code ? (c->control[0] << 8) | c->control[1] : 1005;
                g_free(c->close_reason);
                c->close_reason = n > 2 ? g_strndup((const char *)c->control + 2, n - 2) : g_strdup("");
                c->close_received = TRUE;
                c->state = CLOSING;
                if (!c->close_sent)
                    send_close_frame(c, has_code ? c->close_code : 0, "");
                pump_send(c); /* finishes the connection when the frame is out */
                return FALSE;
            }
            /* The module answers a ping itself (CURLWS_NOAUTOPONG, see js_open). */
            if (!c->close_sent) {
                enqueue(c, c->control, n, CURLWS_PONG);
                pump_send(c);
            }
            if (c->finished)
                return FALSE;
            continue;
        }
        if (!(meta->flags & (CURLWS_TEXT | CURLWS_BINARY)))
            continue; /* a pong from the server: ignore it */
        if (c->message_binary < 0)
            c->message_binary = (meta->flags & CURLWS_BINARY) ? 1 : 0;
        if (c->message->len + n > MAX_MESSAGE) {
            fail(c, "a message is larger than 16 MB");
            return FALSE;
        }
        g_byte_array_append(c->message, buf, (guint)n);
        if (meta->bytesleft == 0 && !(meta->flags & CURLWS_CONT))
            emit_message(c);
    }
}

static gboolean on_io(GIOChannel *ch, GIOCondition cond, gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    guint id;
    if (!c)
        return FALSE;
    id = c->watch;
    if ((cond & G_IO_OUT) && !c->finished)
        pump_send(c);
    if ((cond & (G_IO_IN | G_IO_HUP | G_IO_ERR)) && !c->finished)
        pump_recv(c);
    /* set_watch and finish remove this source themselves. */
    return c->watch == id;
}

static gboolean on_handshake_timeout(gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    if (c) {
        c->handshake_timer = 0;
        fail(c, "the handshake timed out");
    }
    return FALSE;
}

/* curlm.c calls this when the handshake ends. */
static void on_done(CURL *easy, CURLcode result, MrCurlOwner *owner)
{
    Conn *c = (Conn *)owner;
    curl_socket_t s = CURL_SOCKET_BAD;
    JSValue ev;
    if (c->dead || c->finished)
        return;
    if (c->handshake_timer) {
        g_source_remove(c->handshake_timer);
        c->handshake_timer = 0;
    }
    if (result == CURLE_OK && c->protocol) {
        /* A browser fails the connection for a protocol that the client did not offer. */
        guint i;
        gboolean found = FALSE;
        for (i = 0; i < c->offered->len; i++)
            if (!strcmp(g_ptr_array_index(c->offered, i), c->protocol))
                found = TRUE;
        if (!found) {
            fail(c, "the server chose a protocol that the client did not offer");
            return;
        }
    }
    if (result != CURLE_OK) {
        fail(c, c->error[0] ? c->error : curl_easy_strerror(result));
        return;
    }
    curl_easy_getinfo(easy, CURLINFO_ACTIVESOCKET, &s);
    if (s == CURL_SOCKET_BAD) {
        fail(c, "no socket after the handshake");
        return;
    }
    c->channel = g_io_channel_unix_new(s);
    c->state = OPEN;
    ev = new_event("open");
    JS_SetPropertyStr(mr_ctx, ev, "protocol", JS_NewString(mr_ctx, c->protocol ? c->protocol : ""));
    emit_later(c, ev);
    set_watch(c, FALSE);
    pump_recv(c); /* frames that came with the handshake are in curl's buffer already */
}

static size_t on_header(char *buf, size_t size, size_t n, void *data)
{
    Conn *c = data;
    size_t len = size * n;
    static const char name[] = "sec-websocket-protocol:";
    size_t nlen = sizeof name - 1;
    if (len > nlen && !g_ascii_strncasecmp(buf, name, nlen)) {
        gchar *v = g_strndup(buf + nlen, len - nlen);
        g_free(c->protocol);
        c->protocol = g_strdup(g_strstrip(v));
        g_free(v);
    }
    return len;
}

/* Read a string property of options; NULL if absent. Free with JS_FreeCString. */
static const char *opt_string(JSContext *ctx, JSValueConst opts, const char *name)
{
    JSValue v = JS_GetPropertyStr(ctx, opts, name);
    const char *s = (JS_IsUndefined(v) || JS_IsNull(v)) ? NULL : JS_ToCString(ctx, v);
    JS_FreeValue(ctx, v);
    return s;
}

/* The Sec-WebSocket-Protocol header from options.protocols. -1 after a TypeError. */
static int add_protocols(JSContext *ctx, Conn *c, JSValueConst opts)
{
    JSValue list = JS_GetPropertyStr(ctx, opts, "protocols");
    GString *line = g_string_new("Sec-WebSocket-Protocol: ");
    uint32_t i, n = 0;
    int rc = 0;
    if (JS_IsArray(ctx, list)) {
        JSValue lenv = JS_GetPropertyStr(ctx, list, "length");
        JS_ToUint32(ctx, &n, lenv);
        JS_FreeValue(ctx, lenv);
    }
    for (i = 0; i < n && rc == 0; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, list, i);
        const char *s = JS_ToCString(ctx, item);
        if (!s || !*s || strpbrk(s, "\r\n,")) {
            JS_ThrowTypeError(ctx, "open: bad protocol name");
            rc = -1;
        } else {
            if (i)
                g_string_append(line, ", ");
            g_string_append(line, s);
            g_ptr_array_add(c->offered, g_strdup(s));
        }
        if (s)
            JS_FreeCString(ctx, s);
        JS_FreeValue(ctx, item);
    }
    JS_FreeValue(ctx, list);
    if (rc == 0 && n > 0)
        c->req_headers = curl_slist_append(c->req_headers, line->str);
    g_string_free(line, TRUE);
    return rc;
}

static JSValue js_open(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSValueConst opts = argv[0];
    const char *url;
    const char *ca = g_getenv("MR_CA_BUNDLE");
    JSValue v;
    double timeout = 30000;
    Conn *c;
    if (!JS_IsObject(opts) || !JS_IsFunction(ctx, argv[1]))
        return JS_ThrowTypeError(ctx, "open(options, onEvent): wrong arguments");
    if (!(url = opt_string(ctx, opts, "url")))
        return JS_ThrowTypeError(ctx, "open: options.url is missing");
    if (!g_str_has_prefix(url, "ws://") && !g_str_has_prefix(url, "wss://")) {
        JS_FreeCString(ctx, url);
        return JS_ThrowTypeError(ctx, "open: only ws and wss URLs are supported");
    }

    c = g_new0(Conn, 1);
    c->owner.done = on_done;
    c->id = next_id++;
    c->easy = curl_easy_init();
    c->cb = JS_DupValue(ctx, argv[1]);
    c->offered = g_ptr_array_new();
    c->pending = g_queue_new();
    c->outgoing = g_queue_new();
    c->message = g_byte_array_new();
    c->message_binary = -1;
    c->state = CONNECTING;
    g_hash_table_insert(conns, GINT_TO_POINTER(c->id), c);
    curl_easy_setopt(c->easy, CURLOPT_URL, url); /* curl copies strings */
    JS_FreeCString(ctx, url);

    if (add_protocols(ctx, c, opts) < 0) {
        conn_free(c);
        return JS_EXCEPTION;
    }
    c->req_headers = curl_slist_append(c->req_headers, "User-Agent: maemo-react/" MR_VERSION);
    curl_easy_setopt(c->easy, CURLOPT_HTTPHEADER, c->req_headers);
    v = JS_GetPropertyStr(ctx, opts, "timeoutMs");
    if (JS_IsNumber(v))
        JS_ToFloat64(ctx, &timeout, v);
    JS_FreeValue(ctx, v);

    curl_easy_setopt(c->easy, CURLOPT_CONNECT_ONLY, 2L);
    if (!(timeout > 0) || timeout > 1e9) /* NaN, zero, negative or too large */
        timeout = 30000;
    if (timeout > 600000)
        timeout = 600000;
    /* In connect-only mode curl applies CURLOPT_TIMEOUT_MS to nothing (lib/connect.c,
       timeleft_now_ms) and CONNECTTIMEOUT only to the TCP and TLS connect. The
       handshake limit is a GLib timer, which on_done and finish cancel. */
    curl_easy_setopt(c->easy, CURLOPT_CONNECTTIMEOUT_MS, (long)timeout);
    curl_easy_setopt(c->easy, CURLOPT_PROTOCOLS_STR, "ws,wss");
    /* curl 8.22.0 queues the automatic pong but sends it only at the next
       curl_ws_send or at a curl_ws_recv that returns data. After a ping
       curl_ws_recv returns CURLE_AGAIN, so the pong would wait. The module
       sends the pong itself. */
    curl_easy_setopt(c->easy, CURLOPT_WS_OPTIONS, (long)CURLWS_NOAUTOPONG);
    curl_easy_setopt(c->easy, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(c->easy, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c->easy, CURLOPT_ERRORBUFFER, c->error);
    curl_easy_setopt(c->easy, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(c->easy, CURLOPT_HEADERDATA, c);
    if (ca)
        curl_easy_setopt(c->easy, CURLOPT_CAINFO, ca);

    c->handshake_timer = g_timeout_add((guint)timeout, on_handshake_timeout, GINT_TO_POINTER(c->id));
    mr_curl_add(c->easy, &c->owner);
    return JS_NewInt32(ctx, c->id);
}

static Conn *arg_conn(JSContext *ctx, JSValueConst v)
{
    int32_t id;
    Conn *c;
    if (!JS_IsNumber(v) || JS_ToInt32(ctx, &id, v))
        return NULL;
    c = g_hash_table_lookup(conns, GINT_TO_POINTER(id));
    return (c && !c->dead) ? c : NULL;
}

static JSValue js_send(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    size_t len = 0;
    if (!c)
        return JS_ThrowTypeError(ctx, "send: unknown connection");
    if (c->state != OPEN)
        return JS_FALSE; /* connecting or closing: the data is not sent */
    if (JS_IsString(argv[1])) {
        const char *s = JS_ToCStringLen(ctx, &len, argv[1]);
        if (!s)
            return JS_EXCEPTION;
        enqueue(c, (const guint8 *)s, len, CURLWS_TEXT);
        JS_FreeCString(ctx, s);
    } else {
        uint8_t *buf = JS_GetArrayBuffer(ctx, &len, argv[1]); /* a TypeError if it is not one */
        if (!buf)
            return JS_EXCEPTION;
        enqueue(c, buf, len, JS_ToBool(ctx, argv[2]) ? CURLWS_BINARY : CURLWS_TEXT);
    }
    pump_send(c);
    return JS_TRUE;
}

static JSValue js_close(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    int32_t code = 0;
    const char *reason = NULL;
    if (!c || c->state != OPEN)
        return JS_UNDEFINED; /* before open, the prelude uses abort */
    if (argc > 1 && JS_IsNumber(argv[1]))
        JS_ToInt32(ctx, &code, argv[1]);
    if (argc > 2 && JS_IsString(argv[2]))
        reason = JS_ToCString(ctx, argv[2]);
    c->state = CLOSING;
    send_close_frame(c, code, reason ? reason : "");
    if (reason)
        JS_FreeCString(ctx, reason);
    c->close_timer = g_timeout_add(CLOSE_WAIT_MS, on_close_timeout, GINT_TO_POINTER(c->id));
    pump_send(c);
    return JS_UNDEFINED;
}

static gboolean free_dead(gpointer data)
{
    Conn *c = g_hash_table_lookup(conns, data);
    if (c && c->dead)
        conn_free(c);
    return FALSE;
}

static JSValue js_abort(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    if (!c)
        return JS_UNDEFINED;
    c->dead = TRUE;
    drop_pending(c);
    if (in_emit)
        g_idle_add(free_dead, GINT_TO_POINTER(c->id));
    else
        conn_free(c);
    return JS_UNDEFINED;
}

static JSValue js_buffered(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    Conn *c = arg_conn(ctx, argv[0]);
    return JS_NewInt64(ctx, c ? (int64_t)c->buffered : 0);
}

static const JSCFunctionListEntry ws_funcs[] = {
    JS_CFUNC_DEF("open", 2, js_open),
    JS_CFUNC_DEF("send", 3, js_send),
    JS_CFUNC_DEF("close", 3, js_close),
    JS_CFUNC_DEF("abort", 1, js_abort),
    JS_CFUNC_DEF("bufferedAmount", 1, js_buffered),
};

static int ws_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, ws_funcs, G_N_ELEMENTS(ws_funcs));
}

JSModuleDef *mr_init_ws(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, ws_init);
    if (!m)
        return NULL;
    if (!conns)
        conns = g_hash_table_new(g_direct_hash, g_direct_equal);
    JS_AddModuleExportList(ctx, m, ws_funcs, G_N_ELEMENTS(ws_funcs));
    return m;
}
