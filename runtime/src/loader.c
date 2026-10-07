/* ES module loading: maemo:* native modules, and modules from files.
   QuickJS's default normalizer keeps "maemo:http" as it is and resolves
   "./x.js" against the importing module. */
#include <stdio.h>
#include <string.h>
#include "mr.h"

#define MAX_MODULES 32

static struct {
    const char *name;
    mr_module_init_fn init;
} registry[MAX_MODULES];
static int n_registry;

void mr_register_module(const char *name, mr_module_init_fn init)
{
    g_assert(n_registry < MAX_MODULES);
    registry[n_registry].name = name;
    registry[n_registry].init = init;
    n_registry++;
}

/* Compile a file as a module. Returns the module function, or JS_EXCEPTION. */
static JSValue compile_file(JSContext *ctx, const char *path)
{
    gchar *src;
    gsize len;
    GError *err = NULL;
    JSValue fn;
    if (!g_file_get_contents(path, &src, &len, &err)) {
        JS_ThrowReferenceError(ctx, "could not load module '%s': %s", path, err->message);
        g_error_free(err);
        return JS_EXCEPTION;
    }
    fn = JS_Eval(ctx, src, len, path, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    g_free(src);
    return fn;
}

static JSModuleDef *load_module(JSContext *ctx, const char *name, void *opaque)
{
    JSValue fn;
    JSModuleDef *m;
    int i;
    for (i = 0; i < n_registry; i++)
        if (!strcmp(registry[i].name, name))
            return registry[i].init(ctx, name);
    if (!strncmp(name, "maemo:", 6)) {
        JS_ThrowReferenceError(ctx, "unknown native module '%s'", name);
        return NULL;
    }
    fn = compile_file(ctx, name);
    if (JS_IsException(fn))
        return NULL;
    /* The runtime keeps the module definition; the function value can go. */
    m = JS_VALUE_GET_PTR(fn);
    JS_FreeValue(ctx, fn);
    return m;
}

void mr_loader_init(JSRuntime *rt)
{
    JS_SetModuleLoaderFunc(rt, NULL, load_module, NULL);
}

/* Link and evaluate a compiled module. Takes ownership of fn. Returns 0, or
   -1 if evaluation threw or its promise was rejected. */
static int eval_module(JSContext *ctx, JSValue fn)
{
    JSValue ret;
    int state;
    if (JS_ResolveModule(ctx, fn) < 0) {
        JS_FreeValue(ctx, fn);
        mr_report_exception(ctx);
        return -1;
    }
    ret = mr_eval_function(ctx, fn);
    if (JS_IsException(ret)) {
        mr_report_exception(ctx);
        return -1;
    }
    mr_drain_jobs();
    /* A module returns a promise (top-level await). If it is rejected, the
       rejection tracker in loop.c has reported it already. */
    state = JS_PromiseState(ctx, ret);
    JS_FreeValue(ctx, ret);
    return state == JS_PROMISE_REJECTED ? -1 : 0;
}

/* Write the bytecode cache. A failure is not an error: the folder of an
   installed application belongs to root. */
static int write_cache(JSContext *ctx, const char *path, JSValueConst fn)
{
    size_t len;
    int r;
    uint8_t *buf = JS_WriteObject(ctx, &len, fn, JS_WRITE_OBJ_BYTECODE);
    if (!buf) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        return -1;
    }
    r = mr_bc_write(path, buf, len);
    js_free(ctx, buf);
    return r;
}

int mr_run_module_file(JSContext *ctx, const char *path)
{
    size_t len;
    uint8_t *bc = mr_bc_read(path, &len);
    JSValue fn = JS_EXCEPTION;
    if (bc) {
        fn = JS_ReadObject(ctx, bc, len, JS_READ_OBJ_BYTECODE);
        g_free(bc);
        if (JS_IsException(fn)) /* a damaged cache: use the source */
            JS_FreeValue(ctx, JS_GetException(ctx));
    }
    if (JS_IsException(fn)) {
        fn = compile_file(ctx, path);
        if (JS_IsException(fn)) {
            mr_report_exception(ctx);
            return -1;
        }
        write_cache(ctx, path, fn);
    }
    return eval_module(ctx, fn);
}

int mr_compile_file(JSContext *ctx, const char *path)
{
    JSValue fn = compile_file(ctx, path);
    int r;
    if (JS_IsException(fn)) {
        mr_report_exception(ctx);
        return -1;
    }
    r = write_cache(ctx, path, fn);
    JS_FreeValue(ctx, fn);
    if (r < 0) {
        gchar *qbc = mr_bc_path(path);
        fprintf(stderr, "maemo-react-host: cannot write %s\n", qbc);
        g_free(qbc);
    }
    return r;
}
