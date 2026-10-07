/* maemo:http -- HTTP requests with libcurl's multi interface on the GLib
   main loop. JavaScript gets the events headers, data, end and error. The
   prelude builds fetch() on top of it. */
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>
#include "mr.h"

typedef struct {
    MrCurlOwner owner; /* first: curlm.c finds the request through it */
    int id;
    CURL *easy;
    JSValue cb;
    struct curl_slist *req_headers;
    GPtrArray *names;  /* response header names */
    GPtrArray *values; /* response header values */
    gchar *status_text;
    gboolean headers_sent;
    gboolean aborted;
    GQueue *pending;   /* events for JavaScript, as JSValue pointers */
    guint flush_source;
    char error[CURL_ERROR_SIZE];
} Req;

static GHashTable *requests; /* id -> Req */
static int next_id = 1;
static int in_emit; /* above zero while an event runs in JavaScript: abort must not free the request at once */

static void clear_headers(Req *r)
{
    guint i;
    for (i = 0; i < r->names->len; i++) {
        g_free(g_ptr_array_index(r->names, i));
        g_free(g_ptr_array_index(r->values, i));
    }
    g_ptr_array_set_size(r->names, 0);
    g_ptr_array_set_size(r->values, 0);
}

static void drop_pending(Req *r)
{
    JSValue *ev;
    while ((ev = g_queue_pop_head(r->pending)) != NULL) {
        JS_FreeValue(mr_ctx, *ev);
        g_free(ev);
    }
}

static void req_free(Req *r)
{
    if (r->flush_source)
        g_source_remove(r->flush_source);
    drop_pending(r);
    g_queue_free(r->pending);
    g_hash_table_remove(requests, GINT_TO_POINTER(r->id));
    mr_curl_remove(r->easy);
    curl_easy_cleanup(r->easy);
    curl_slist_free_all(r->req_headers);
    clear_headers(r);
    g_ptr_array_free(r->names, TRUE);
    g_ptr_array_free(r->values, TRUE);
    g_free(r->status_text);
    JS_FreeValue(mr_ctx, r->cb);
    g_free(r);
}

static JSValue new_event(const char *type)
{
    JSValue ev = JS_NewObject(mr_ctx);
    JS_SetPropertyStr(mr_ctx, ev, "type", JS_NewString(mr_ctx, type));
    return ev;
}

/* Give an event to JavaScript. Takes ownership of ev. */
static void emit(Req *r, JSValue ev)
{
    JSValue res;
    in_emit++;
    res = mr_call(r->cb, JS_UNDEFINED, 1, (JSValueConst *)&ev);
    in_emit--;
    JS_FreeValue(mr_ctx, res);
    JS_FreeValue(mr_ctx, ev);
}

/* Give the queued events to JavaScript. */
static void flush_req(Req *r)
{
    JSValue *ev;
    while (!r->aborted && (ev = g_queue_pop_head(r->pending)) != NULL) {
        emit(r, *ev);
        g_free(ev);
    }
    if (r->aborted)
        drop_pending(r);
}

static gboolean on_flush(gpointer data)
{
    Req *r = g_hash_table_lookup(requests, data);
    if (r) {
        r->flush_source = 0;
        flush_req(r);
    }
    return FALSE;
}

/* curl calls on_header and on_write. JavaScript must not run inside them: a
 * promise callback can start a new request, and curl forbids that there. Queue
 * the event, and give it to JavaScript from the main loop. Takes ownership. */
static void emit_later(Req *r, JSValue ev)
{
    JSValue *copy = g_new(JSValue, 1);
    *copy = ev;
    g_queue_push_tail(r->pending, copy);
    if (!r->flush_source)
        r->flush_source = g_idle_add_full(G_PRIORITY_DEFAULT, on_flush, GINT_TO_POINTER(r->id), NULL);
}

static void send_headers(Req *r)
{
    JSValue ev, list;
    char *url = NULL;
    long status = 0, redirects = 0;
    guint i;
    if (r->headers_sent)
        return;
    r->headers_sent = TRUE;
    curl_easy_getinfo(r->easy, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_getinfo(r->easy, CURLINFO_EFFECTIVE_URL, &url);
    curl_easy_getinfo(r->easy, CURLINFO_REDIRECT_COUNT, &redirects);
    ev = new_event("headers");
    JS_SetPropertyStr(mr_ctx, ev, "status", JS_NewInt32(mr_ctx, (int32_t)status));
    JS_SetPropertyStr(mr_ctx, ev, "statusText", JS_NewString(mr_ctx, r->status_text ? r->status_text : ""));
    JS_SetPropertyStr(mr_ctx, ev, "url", JS_NewString(mr_ctx, url ? url : ""));
    JS_SetPropertyStr(mr_ctx, ev, "redirected", JS_NewBool(mr_ctx, redirects > 0));
    list = JS_NewArray(mr_ctx);
    for (i = 0; i < r->names->len; i++) {
        JSValue pair = JS_NewArray(mr_ctx);
        JS_SetPropertyUint32(mr_ctx, pair, 0, JS_NewString(mr_ctx, g_ptr_array_index(r->names, i)));
        JS_SetPropertyUint32(mr_ctx, pair, 1, JS_NewString(mr_ctx, g_ptr_array_index(r->values, i)));
        JS_SetPropertyUint32(mr_ctx, list, i, pair);
    }
    JS_SetPropertyStr(mr_ctx, ev, "headers", list);
    emit_later(r, ev);
}

static size_t on_header(char *buf, size_t size, size_t n, void *data)
{
    Req *r = data;
    size_t len = size * n;
    gchar *line = g_strndup(buf, len);
    gchar *colon;
    g_strchomp(line);
    if (g_str_has_prefix(line, "HTTP/")) {
        /* A new response (after a redirect or a 100): forget the last one. */
        gchar **parts = g_strsplit(line, " ", 3);
        clear_headers(r);
        g_free(r->status_text);
        r->status_text = g_strdup(parts[0] && parts[1] && parts[2] ? parts[2] : "");
        g_strfreev(parts);
    } else if ((colon = strchr(line, ':')) != NULL) {
        *colon = '\0';
        g_ptr_array_add(r->names, g_strdup(line));
        g_ptr_array_add(r->values, g_strdup(g_strstrip(colon + 1)));
    }
    g_free(line);
    return len;
}

static size_t on_write(char *buf, size_t size, size_t n, void *data)
{
    Req *r = data;
    JSValue ev;
    if (r->aborted)
        return 0; /* curl stops the transfer */
    send_headers(r);
    if (r->aborted)
        return 0;
    ev = new_event("data");
    JS_SetPropertyStr(mr_ctx, ev, "chunk", JS_NewArrayBufferCopy(mr_ctx, (uint8_t *)buf, size * n));
    emit_later(r, ev);
    return r->aborted ? 0 : size * n;
}

static gboolean free_aborted(gpointer data)
{
    Req *r = g_hash_table_lookup(requests, data);
    if (r && r->aborted)
        req_free(r);
    return FALSE;
}

/* curlm.c calls this when the transfer ends. */
static void on_done(CURL *easy, CURLcode result, MrCurlOwner *owner)
{
    Req *r = (Req *)owner;
    if (!r->aborted) {
        if (result == CURLE_OK) {
            send_headers(r);
            flush_req(r);
            if (!r->aborted)
                emit(r, new_event("end"));
        } else {
            flush_req(r);
            if (!r->aborted) {
                JSValue ev = new_event("error");
                const char *text = r->error[0] ? r->error : curl_easy_strerror(result);
                JS_SetPropertyStr(mr_ctx, ev, "message", JS_NewString(mr_ctx, text));
                JS_SetPropertyStr(mr_ctx, ev, "code", JS_NewInt32(mr_ctx, result));
                emit(r, ev);
            }
        }
    }
    req_free(r);
}

/* Read a string property of options; NULL if absent. Free with JS_FreeCString. */
static const char *opt_string(JSContext *ctx, JSValueConst opts, const char *name)
{
    JSValue v = JS_GetPropertyStr(ctx, opts, name);
    const char *s = (JS_IsUndefined(v) || JS_IsNull(v)) ? NULL : JS_ToCString(ctx, v);
    JS_FreeValue(ctx, v);
    return s;
}

/* An HTTP token: the characters allowed in a method and in a header name. */
static gboolean is_token(const char *s)
{
    if (!*s)
        return FALSE;
    for (; *s; s++) {
        if (!g_ascii_isalnum(*s) && !strchr("!#$%&'*+-.^_`|~", *s))
            return FALSE;
    }
    return TRUE;
}

static int add_headers(JSContext *ctx, Req *r, JSValueConst opts)
{
    JSValue list = JS_GetPropertyStr(ctx, opts, "headers");
    gboolean has_agent = FALSE;
    uint32_t i, n = 0;
    int rc = 0;
    if (JS_IsArray(ctx, list)) {
        JSValue lenv = JS_GetPropertyStr(ctx, list, "length");
        JS_ToUint32(ctx, &n, lenv);
        JS_FreeValue(ctx, lenv);
    }
    for (i = 0; i < n && rc == 0; i++) {
        JSValue pair = JS_GetPropertyUint32(ctx, list, i);
        JSValue k = JS_GetPropertyUint32(ctx, pair, 0);
        JSValue v = JS_GetPropertyUint32(ctx, pair, 1);
        size_t vlen = 0;
        const char *ks = JS_ToCString(ctx, k);
        const char *vs = JS_ToCStringLen(ctx, &vlen, v);
        if (ks && vs && (!is_token(ks) || strpbrk(vs, "\r\n") || strlen(vs) != vlen)) {
            JS_ThrowTypeError(ctx, "request: bad header \"%s\"", ks);
            rc = -1;
        } else if (ks && vs) {
            gchar *line = g_strdup_printf("%s: %s", ks, vs);
            r->req_headers = curl_slist_append(r->req_headers, line);
            g_free(line);
            if (!g_ascii_strcasecmp(ks, "user-agent"))
                has_agent = TRUE;
        }
        if (ks)
            JS_FreeCString(ctx, ks);
        if (vs)
            JS_FreeCString(ctx, vs);
        JS_FreeValue(ctx, k);
        JS_FreeValue(ctx, v);
        JS_FreeValue(ctx, pair);
    }
    JS_FreeValue(ctx, list);
    if (rc < 0)
        return rc;
    if (!has_agent)
        r->req_headers = curl_slist_append(r->req_headers, "User-Agent: maemo-react/" MR_VERSION);
    r->req_headers = curl_slist_append(r->req_headers, "Expect:"); /* no 100-continue wait */
    curl_easy_setopt(r->easy, CURLOPT_HTTPHEADER, r->req_headers);
    return 0;
}

static int set_method_and_body(JSContext *ctx, Req *r, JSValueConst opts)
{
    const char *method = opt_string(ctx, opts, "method");
    JSValue body = JS_GetPropertyStr(ctx, opts, "body");
    uint8_t *buf = NULL;
    size_t len = 0;
    int rc = 0;
    if (method && !is_token(method)) {
        JS_ThrowTypeError(ctx, "request: bad method");
        rc = -1;
    }
    if (rc == 0 && !JS_IsUndefined(body) && !JS_IsNull(body)) {
        buf = JS_GetArrayBuffer(ctx, &len, body); /* a TypeError if it is not one */
        if (!buf)
            rc = -1;
    }
    if (rc == 0) {
        if (method && !strcmp(method, "HEAD")) {
            curl_easy_setopt(r->easy, CURLOPT_NOBODY, 1L);
        } else if (method && !strcmp(method, "POST")) {
            /* Not CUSTOMREQUEST: then a 302 or 303 becomes a GET, as in browsers. */
            curl_easy_setopt(r->easy, CURLOPT_POST, 1L);
        } else if (method && strcmp(method, "GET")) {
            curl_easy_setopt(r->easy, CURLOPT_CUSTOMREQUEST, method);
        }
        if (buf || (method && !strcmp(method, "POST"))) {
            curl_easy_setopt(r->easy, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t)len);
            curl_easy_setopt(r->easy, CURLOPT_COPYPOSTFIELDS, buf ? (char *)buf : "");
        }
    }
    if (method)
        JS_FreeCString(ctx, method);
    JS_FreeValue(ctx, body);
    return rc;
}

static JSValue js_request(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSValueConst opts = argv[0];
    const char *url;
    const char *ca = g_getenv("MR_CA_BUNDLE");
    JSValue v;
    double timeout = 0;
    int follow = 1;
    Req *r;
    if (!JS_IsObject(opts) || !JS_IsFunction(ctx, argv[1]))
        return JS_ThrowTypeError(ctx, "request(options, onEvent): wrong arguments");
    if (!(url = opt_string(ctx, opts, "url")))
        return JS_ThrowTypeError(ctx, "request: options.url is missing");

    r = g_new0(Req, 1);
    r->id = next_id++;
    r->easy = curl_easy_init();
    r->cb = JS_DupValue(ctx, argv[1]);
    r->pending = g_queue_new();
    r->names = g_ptr_array_new();
    r->values = g_ptr_array_new();
    curl_easy_setopt(r->easy, CURLOPT_URL, url); /* curl copies strings */
    JS_FreeCString(ctx, url);

    if (add_headers(ctx, r, opts) < 0 || set_method_and_body(ctx, r, opts) < 0) {
        g_hash_table_insert(requests, GINT_TO_POINTER(r->id), r);
        req_free(r);
        return JS_EXCEPTION;
    }
    v = JS_GetPropertyStr(ctx, opts, "timeoutMs");
    if (JS_IsNumber(v))
        JS_ToFloat64(ctx, &timeout, v);
    JS_FreeValue(ctx, v);
    v = JS_GetPropertyStr(ctx, opts, "followRedirects");
    if (JS_IsBool(v))
        follow = JS_ToBool(ctx, v);
    JS_FreeValue(ctx, v);

    if (timeout > 0)
        curl_easy_setopt(r->easy, CURLOPT_TIMEOUT_MS, (long)timeout);
    curl_easy_setopt(r->easy, CURLOPT_CONNECTTIMEOUT_MS, 30000L);
    curl_easy_setopt(r->easy, CURLOPT_FOLLOWLOCATION, (long)follow);
    curl_easy_setopt(r->easy, CURLOPT_MAXREDIRS, 20L);
    /* JavaScript must not reach file:, ftp: and the like, also by redirect. */
    curl_easy_setopt(r->easy, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(r->easy, CURLOPT_REDIR_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(r->easy, CURLOPT_ACCEPT_ENCODING, ""); /* gzip and deflate */
    curl_easy_setopt(r->easy, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(r->easy, CURLOPT_ERRORBUFFER, r->error);
    curl_easy_setopt(r->easy, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(r->easy, CURLOPT_HEADERDATA, r);
    curl_easy_setopt(r->easy, CURLOPT_WRITEFUNCTION, on_write);
    curl_easy_setopt(r->easy, CURLOPT_WRITEDATA, r);
    if (ca)
        curl_easy_setopt(r->easy, CURLOPT_CAINFO, ca);

    r->owner.done = on_done;
    g_hash_table_insert(requests, GINT_TO_POINTER(r->id), r);
    mr_curl_add(r->easy, &r->owner);
    return JS_NewInt32(ctx, r->id);
}

static JSValue js_abort(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t id;
    Req *r;
    if (!JS_IsNumber(argv[0]) || JS_ToInt32(ctx, &id, argv[0]))
        return JS_UNDEFINED;
    r = g_hash_table_lookup(requests, GINT_TO_POINTER(id));
    if (!r || r->aborted)
        return JS_UNDEFINED;
    r->aborted = TRUE;
    if (in_emit)
        g_idle_add(free_aborted, GINT_TO_POINTER(id));
    else
        req_free(r);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry http_funcs[] = {
    JS_CFUNC_DEF("request", 2, js_request),
    JS_CFUNC_DEF("abort", 1, js_abort),
};

static int http_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, http_funcs, G_N_ELEMENTS(http_funcs));
}

JSModuleDef *mr_init_http(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, http_init);
    if (!m)
        return NULL;
    if (!requests)
        requests = g_hash_table_new(g_direct_hash, g_direct_equal);
    JS_AddModuleExportList(ctx, m, http_funcs, G_N_ELEMENTS(http_funcs));
    return m;
}
