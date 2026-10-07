/* GClosures that call JavaScript functions, for maemo:gobject connect().
   GLib frees a closure when the object goes away; then we free the function. */
#include <gtk/gtk.h>
#include "mr.h"

#define MAX_SIGNAL_ARGS 16

typedef struct {
    GClosure closure;
    JSValue fn;
} JsClosure;

static int live_closures;

int mr_closure_count(void)
{
    return live_closures;
}

static void closure_invalidate(gpointer data, GClosure *c)
{
    JsClosure *jc = (JsClosure *)c;
    JS_FreeValue(mr_ctx, jc->fn);
    jc->fn = JS_UNDEFINED;
    live_closures--;
}

static void closure_marshal(GClosure *c, GValue *ret, guint n_params, const GValue *params,
                            gpointer hint, gpointer data)
{
    JsClosure *jc = (JsClosure *)c;
    JSValue args[MAX_SIGNAL_ARGS], r, fn;
    guint i, argc = n_params > 0 ? n_params - 1 : 0; /* params[0] is the instance */
    if (argc > MAX_SIGNAL_ARGS)
        argc = MAX_SIGNAL_ARGS;
    for (i = 0; i < argc; i++)
        args[i] = mr_gvalue_to_js(mr_ctx, &params[i + 1], 0);
    /* The handler can destroy the object and so free the closure. Hold the
       function until the call ends. */
    fn = JS_DupValue(mr_ctx, jc->fn);
    r = mr_call(fn, JS_UNDEFINED, argc, (JSValueConst *)args);
    JS_FreeValue(mr_ctx, fn);
    for (i = 0; i < argc; i++)
        JS_FreeValue(mr_ctx, args[i]);
    if (ret && G_IS_VALUE(ret) && !JS_IsUndefined(r)) {
        if (mr_js_to_gvalue(mr_ctx, r, ret, NULL, "the return value of a signal handler") < 0)
            mr_report_exception(mr_ctx);
    }
    JS_FreeValue(mr_ctx, r);
}

GClosure *mr_closure_new(JSContext *ctx, JSValueConst fn)
{
    GClosure *c = g_closure_new_simple(sizeof(JsClosure), NULL);
    ((JsClosure *)c)->fn = JS_DupValue(ctx, fn);
    live_closures++;
    g_closure_add_invalidate_notifier(c, NULL, closure_invalidate);
    g_closure_set_marshal(c, closure_marshal);
    return c;
}
