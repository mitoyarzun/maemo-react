/* console.* and performance.now(). These print strings only. The prelude
   (Task 8) replaces console.* with versions that format objects. */
#include <stdio.h>
#include <time.h>
#include "mr.h"

static double start_ms;

double mr_now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static JSValue print_to(FILE *f, JSContext *ctx, int argc, JSValueConst *argv)
{
    int i;
    for (i = 0; i < argc; i++) {
        const char *s = JS_ToCString(ctx, argv[i]);
        fprintf(f, "%s%s", i ? " " : "", s ? s : "");
        if (s)
            JS_FreeCString(ctx, s);
    }
    fputc('\n', f);
    fflush(f);
    return JS_UNDEFINED;
}

static JSValue js_out(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return print_to(stdout, ctx, argc, argv);
}

static JSValue js_err(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return print_to(stderr, ctx, argc, argv);
}

static JSValue js_now(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    return JS_NewFloat64(ctx, mr_now_ms() - start_ms);
}

void mr_console_init(JSContext *ctx)
{
    JSValue g = JS_GetGlobalObject(ctx);
    JSValue con = JS_NewObject(ctx);
    JSValue perf = JS_NewObject(ctx);
    start_ms = mr_now_ms();
    JS_SetPropertyStr(ctx, con, "log", JS_NewCFunction(ctx, js_out, "log", 1));
    JS_SetPropertyStr(ctx, con, "info", JS_NewCFunction(ctx, js_out, "info", 1));
    JS_SetPropertyStr(ctx, con, "debug", JS_NewCFunction(ctx, js_out, "debug", 1));
    JS_SetPropertyStr(ctx, con, "warn", JS_NewCFunction(ctx, js_err, "warn", 1));
    JS_SetPropertyStr(ctx, con, "error", JS_NewCFunction(ctx, js_err, "error", 1));
    JS_SetPropertyStr(ctx, g, "console", con);
    JS_SetPropertyStr(ctx, perf, "now", JS_NewCFunction(ctx, js_now, "now", 0));
    JS_SetPropertyStr(ctx, g, "performance", perf);
    JS_FreeValue(ctx, g);
}
