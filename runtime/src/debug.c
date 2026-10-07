/* maemo:debug -- numbers for tests and benchmarks. */
#include <stdlib.h>
#include <gtk/gtk.h>
#include "mr.h"

static JSValue js_stats(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JSMemoryUsage mu;
    JSValue o = JS_NewObject(ctx);
    JS_ComputeMemoryUsage(mr_rt, &mu);
    JS_SetPropertyStr(ctx, o, "handles", JS_NewInt32(ctx, mr_bridge_handle_count()));
    JS_SetPropertyStr(ctx, o, "closures", JS_NewInt32(ctx, mr_closure_count()));
    JS_SetPropertyStr(ctx, o, "jsMallocSize", JS_NewInt64(ctx, mu.malloc_size));
    return o;
}

static JSValue js_bridge_time(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double v = mr_bridge_ms;
    mr_bridge_ms = 0;
    return JS_NewFloat64(ctx, v);
}

static JSValue js_flush_paint(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gdk_window_process_all_updates();
    gdk_flush();
    return JS_UNDEFINED;
}

static JSValue js_gc(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    JS_RunGC(mr_rt);
    return JS_UNDEFINED;
}

static gchar *read_line(const char *path)
{
    gchar *s = NULL;
    if (!g_file_get_contents(path, &s, NULL, NULL))
        return NULL;
    return g_strstrip(s);
}

static JSValue js_cpu(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *gov = read_line("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor");
    gchar *khz = read_line("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq");
    JSValue o;
    if (!gov) {
        g_free(khz);
        return JS_NULL;
    }
    o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "governor", JS_NewString(ctx, gov));
    JS_SetPropertyStr(ctx, o, "kHz", khz ? JS_NewInt32(ctx, atoi(khz)) : JS_NULL);
    g_free(gov);
    g_free(khz);
    return o;
}

static const JSCFunctionListEntry debug_funcs[] = {
    JS_CFUNC_DEF("stats", 0, js_stats),
    JS_CFUNC_DEF("bridgeTime", 0, js_bridge_time),
    JS_CFUNC_DEF("flushPaint", 0, js_flush_paint),
    JS_CFUNC_DEF("gc", 0, js_gc),
    JS_CFUNC_DEF("cpu", 0, js_cpu),
};

static int debug_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, debug_funcs, G_N_ELEMENTS(debug_funcs));
}

JSModuleDef *mr_init_debug(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, debug_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, debug_funcs, G_N_ELEMENTS(debug_funcs));
    return m;
}
