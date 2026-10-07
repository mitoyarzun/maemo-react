/* The curl multi handle on the GLib main loop. http.c and ws.c add easy
   handles to it. The owner of an easy handle is a struct that starts with
   an MrCurlOwner; curl keeps the pointer in CURLOPT_PRIVATE. When a transfer
   ends, the done callback of the owner runs. It runs from the main loop, not
   inside a curl callback, so it may run JavaScript and free the handle. */
#include <curl/curl.h>
#include "mr.h"

typedef struct {
    GIOChannel *channel;
    guint watch;
} Sock;

static CURLM *multi;
static guint timer_source;

static void check_done(void)
{
    CURLMsg *msg;
    int left;
    while ((msg = curl_multi_info_read(multi, &left))) {
        MrCurlOwner *owner = NULL;
        if (msg->msg != CURLMSG_DONE)
            continue;
        curl_easy_getinfo(msg->easy_handle, CURLINFO_PRIVATE, (char **)&owner);
        if (owner && owner->done)
            owner->done(msg->easy_handle, msg->data.result, owner);
    }
}

static gboolean on_io(GIOChannel *ch, GIOCondition cond, gpointer data)
{
    int running, flags = 0;
    if (cond & (G_IO_IN | G_IO_HUP))
        flags |= CURL_CSELECT_IN;
    if (cond & G_IO_OUT)
        flags |= CURL_CSELECT_OUT;
    if (cond & (G_IO_ERR | G_IO_NVAL))
        flags |= CURL_CSELECT_ERR;
    curl_multi_socket_action(multi, g_io_channel_unix_get_fd(ch), flags, &running);
    check_done();
    return TRUE;
}

static int on_socket(CURL *easy, curl_socket_t s, int what, void *userp, void *socketp)
{
    Sock *k = socketp;
    GIOCondition cond = G_IO_ERR;
    if (what == CURL_POLL_REMOVE) {
        if (k) {
            g_source_remove(k->watch);
            g_io_channel_unref(k->channel);
            g_free(k);
        }
        curl_multi_assign(multi, s, NULL);
        return 0;
    }
    if (!k) {
        k = g_new0(Sock, 1);
        k->channel = g_io_channel_unix_new(s);
        curl_multi_assign(multi, s, k);
    } else {
        g_source_remove(k->watch);
    }
    if (what & CURL_POLL_IN)
        cond |= G_IO_IN | G_IO_HUP;
    if (what & CURL_POLL_OUT)
        cond |= G_IO_OUT;
    k->watch = g_io_add_watch(k->channel, cond, on_io, NULL);
    return 0;
}

static gboolean on_timeout(gpointer data)
{
    int running;
    timer_source = 0;
    curl_multi_socket_action(multi, CURL_SOCKET_TIMEOUT, 0, &running);
    check_done();
    return FALSE;
}

static int on_timer(CURLM *m, long ms, void *userp)
{
    if (timer_source) {
        g_source_remove(timer_source);
        timer_source = 0;
    }
    if (ms >= 0)
        timer_source = g_timeout_add((guint)ms, on_timeout, NULL);
    return 0;
}

CURLM *mr_curl_multi(void)
{
    if (!multi) {
        curl_global_init(CURL_GLOBAL_DEFAULT);
        multi = curl_multi_init();
        curl_multi_setopt(multi, CURLMOPT_SOCKETFUNCTION, on_socket);
        curl_multi_setopt(multi, CURLMOPT_TIMERFUNCTION, on_timer);
    }
    return multi;
}

void mr_curl_add(CURL *easy, MrCurlOwner *owner)
{
    curl_easy_setopt(easy, CURLOPT_PRIVATE, owner);
    curl_multi_add_handle(mr_curl_multi(), easy);
}

void mr_curl_remove(CURL *easy)
{
    if (multi)
        curl_multi_remove_handle(multi, easy);
}
