/* Calls into JavaScript, the promise job queue, unhandled rejections and
   the exit code. */
#include <stdio.h>
#include <stdlib.h>
#include <gtk/gtk.h>
#include "mr.h"

static int call_depth;
static int exit_code;
static int quit_requested;

/* Rejections without a handler. A handler can still come later in the same
   job run, so we report only after the job queue is empty. */
typedef struct {
    JSValue promise;
    JSValue reason;
} Rejection;
static GPtrArray *rejections;

static void print_error(JSContext *ctx, const char *prefix, JSValueConst err)
{
    const char *msg = JS_ToCString(ctx, err);
    JSValue stack = JS_IsObject(err) ? JS_GetPropertyStr(ctx, err, "stack") : JS_UNDEFINED;
    const char *st = JS_IsString(stack) ? JS_ToCString(ctx, stack) : NULL;
    fprintf(stderr, "%s%s\n%s", prefix, msg ? msg : "(no message)", st ? st : "");
    fflush(stderr);
    if (st)
        JS_FreeCString(ctx, st);
    if (msg)
        JS_FreeCString(ctx, msg);
    JS_FreeValue(ctx, stack);
}

void mr_report_exception(JSContext *ctx)
{
    JSValue e = JS_GetException(ctx);
    print_error(ctx, "Uncaught ", e);
    JS_FreeValue(ctx, e);
    if (mr_test_mode)
        mr_quit(1);
}

static void on_rejection(JSContext *ctx, JSValueConst promise, JSValueConst reason,
                         JS_BOOL is_handled, void *opaque)
{
    guint i;
    if (!is_handled) {
        Rejection *r = g_new(Rejection, 1);
        r->promise = JS_DupValue(ctx, promise);
        r->reason = JS_DupValue(ctx, reason);
        g_ptr_array_add(rejections, r);
        return;
    }
    for (i = 0; i < rejections->len; i++) {
        Rejection *r = g_ptr_array_index(rejections, i);
        if (JS_VALUE_GET_PTR(r->promise) == JS_VALUE_GET_PTR(promise)) {
            JS_FreeValue(ctx, r->promise);
            JS_FreeValue(ctx, r->reason);
            g_free(r);
            g_ptr_array_remove_index(rejections, i);
            return;
        }
    }
}

static void report_rejections(void)
{
    while (rejections->len > 0) {
        Rejection *r = g_ptr_array_index(rejections, 0);
        g_ptr_array_remove_index(rejections, 0);
        print_error(mr_ctx, "Unhandled promise rejection: ", r->reason);
        JS_FreeValue(mr_ctx, r->promise);
        JS_FreeValue(mr_ctx, r->reason);
        g_free(r);
        if (mr_test_mode)
            mr_quit(1);
    }
}

void mr_loop_init(JSRuntime *rt)
{
    rejections = g_ptr_array_new();
    JS_SetHostPromiseRejectionTracker(rt, on_rejection, NULL);
}

/* Run the queued promise jobs, but only when no JavaScript is on the stack:
   a job must not run inside another call. */
void mr_drain_jobs(void)
{
    JSContext *c;
    int r;
    if (call_depth > 0)
        return;
    call_depth++;
    while ((r = JS_ExecutePendingJob(mr_rt, &c)) != 0)
        if (r < 0)
            mr_report_exception(c);
    call_depth--;
    report_rejections();
}

JSValue mr_call(JSValueConst fn, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSValue r;
    call_depth++;
    r = JS_Call(mr_ctx, fn, this_val, argc, argv);
    call_depth--;
    if (JS_IsException(r)) {
        mr_report_exception(mr_ctx);
        r = JS_UNDEFINED;
    }
    mr_drain_jobs();
    return r;
}

/* Evaluate a module function. Its top-level code is JavaScript on the stack,
   so jobs must not run until it returns. Takes ownership of fn. */
JSValue mr_eval_function(JSContext *ctx, JSValue fn)
{
    JSValue r;
    call_depth++;
    r = JS_EvalFunction(ctx, fn);
    call_depth--;
    return r;
}

void mr_quit(int code)
{
    if (!quit_requested)
        exit_code = code;
    quit_requested = 1;
    if (gtk_main_level() > 0)
        gtk_main_quit();
}

int mr_quit_requested(void) { return quit_requested; }
int mr_exit_code(void) { return exit_code; }

/* ---- setTimeout, setInterval, clearTimeout, clearInterval ---- */

typedef struct {
    int id;
    guint source;
    JSValue fn;
    JSValue *args;
    int argc;
    gboolean repeat;
    gboolean firing;    /* the callback runs now */
    gboolean cancelled; /* cleared during its own callback */
} Timer;

static GHashTable *timers; /* id -> Timer */
static int next_timer_id = 1;

/* GLib calls this when the source goes away; it is the only place that
   frees a timer. */
static void timer_destroy(gpointer data)
{
    Timer *t = data;
    int i;
    g_hash_table_remove(timers, GINT_TO_POINTER(t->id));
    JS_FreeValue(mr_ctx, t->fn);
    for (i = 0; i < t->argc; i++)
        JS_FreeValue(mr_ctx, t->args[i]);
    g_free(t->args);
    g_free(t);
}

static gboolean timer_fire(gpointer data)
{
    Timer *t = data;
    JSValue r;
    t->firing = TRUE;
    r = mr_call(t->fn, JS_UNDEFINED, t->argc, (JSValueConst *)t->args);
    JS_FreeValue(mr_ctx, r);
    t->firing = FALSE;
    return t->repeat && !t->cancelled;
}

static JSValue add_timer(JSContext *ctx, int argc, JSValueConst *argv, gboolean repeat)
{
    Timer *t;
    double ms = 0;
    int i;
    if (argc < 1 || !JS_IsFunction(ctx, argv[0]))
        return JS_ThrowTypeError(ctx, "%s: the first argument must be a function",
                                 repeat ? "setInterval" : "setTimeout");
    if (argc > 1 && JS_ToFloat64(ctx, &ms, argv[1]))
        return JS_EXCEPTION;
    if (!(ms >= 0))
        ms = 0; /* negative or NaN */
    if (ms > G_MAXINT)
        ms = G_MAXINT;
    if (repeat && ms < 1)
        ms = 1; /* an interval of 0 would keep the CPU busy */
    t = g_new0(Timer, 1);
    t->id = next_timer_id++;
    t->fn = JS_DupValue(ctx, argv[0]);
    t->repeat = repeat;
    t->argc = argc > 2 ? argc - 2 : 0;
    t->args = g_new(JSValue, t->argc ? t->argc : 1);
    for (i = 0; i < t->argc; i++)
        t->args[i] = JS_DupValue(ctx, argv[i + 2]);
    g_hash_table_insert(timers, GINT_TO_POINTER(t->id), t);
    t->source = g_timeout_add_full(G_PRIORITY_DEFAULT, (guint)ms, timer_fire, t, timer_destroy);
    return JS_NewInt32(ctx, t->id);
}

static JSValue js_set_timeout(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return add_timer(ctx, argc, argv, FALSE);
}

static JSValue js_set_interval(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return add_timer(ctx, argc, argv, TRUE);
}

static JSValue js_clear_timer(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t id;
    Timer *t;
    /* Like browsers: an id that is not a known timer does nothing. */
    if (argc < 1 || !JS_IsNumber(argv[0]) || JS_ToInt32(ctx, &id, argv[0]))
        return JS_UNDEFINED;
    t = g_hash_table_lookup(timers, GINT_TO_POINTER(id));
    if (!t)
        return JS_UNDEFINED;
    if (t->firing)
        t->cancelled = TRUE; /* timer_fire returns FALSE; GLib then frees it */
    else
        g_source_remove(t->source);
    return JS_UNDEFINED;
}

void mr_timers_init(JSContext *ctx)
{
    JSValue g = JS_GetGlobalObject(ctx);
    timers = g_hash_table_new(g_direct_hash, g_direct_equal);
    JS_SetPropertyStr(ctx, g, "setTimeout", JS_NewCFunction(ctx, js_set_timeout, "setTimeout", 2));
    JS_SetPropertyStr(ctx, g, "setInterval", JS_NewCFunction(ctx, js_set_interval, "setInterval", 2));
    JS_SetPropertyStr(ctx, g, "clearTimeout", JS_NewCFunction(ctx, js_clear_timer, "clearTimeout", 1));
    JS_SetPropertyStr(ctx, g, "clearInterval", JS_NewCFunction(ctx, js_clear_timer, "clearInterval", 1));
    JS_FreeValue(ctx, g);
}
