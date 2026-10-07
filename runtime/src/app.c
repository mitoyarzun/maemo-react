/* maemo:app -- quit(code), args, version, platform. */
#include <stdlib.h>
#include <string.h>
#include "mr.h"

static int app_argc;
static char **app_argv;

void mr_app_set_args(int argc, char **argv)
{
    app_argc = argc;
    app_argv = argv;
}

/* An id is a folder name: not empty, not "." or "..", and without "/". */
static gboolean id_is_valid(const char *id)
{
    return *id && strcmp(id, ".") && strcmp(id, "..") && !strchr(id, '/');
}

/* The application id: $MR_APP_ID, else the <id> of
   MR_APPS_DIR/<id>/app.js, else the base name of the module file without
   its extension. */
const char *mr_app_id(void)
{
    static gchar *id;
    const char *env = g_getenv("MR_APP_ID");
    gchar *base;
    char *real;
    const char *module;
    if (id)
        return id;
    real = app_argc > 0 ? realpath(app_argv[0], NULL) : NULL;
    module = real ? real : app_argc > 0 ? app_argv[0] : "";
    if (env && id_is_valid(env)) {
        g_free(real);
        return id = g_strdup(env);
    }
    if (g_str_has_prefix(module, MR_APPS_DIR "/")) {
        const char *rest = module + strlen(MR_APPS_DIR) + 1;
        const char *slash = strchr(rest, '/');
        if (slash && slash > rest) {
            id = g_strndup(rest, slash - rest);
            g_free(real);
            return id;
        }
    }
    g_free(real);
    base = app_argc > 0 ? g_path_get_basename(app_argv[0]) : g_strdup("app");
    if (g_str_has_suffix(base, ".js"))
        base[strlen(base) - 3] = '\0';
    else if (g_str_has_suffix(base, ".mjs"))
        base[strlen(base) - 4] = '\0';
    if (!id_is_valid(base)) {
        g_free(base);
        base = g_strdup("app");
    }
    return id = base;
}

/* $MR_DATA_DIR/<id>, else <home>/.maemo-react/<id> (spec section 7). Free it. */
gchar *mr_app_data_dir(void)
{
    const char *base = g_getenv("MR_DATA_DIR");
    if (base && *base)
        return g_build_filename(base, mr_app_id(), NULL);
    return g_build_filename(g_get_home_dir(), ".maemo-react", mr_app_id(), NULL);
}

static JSValue js_quit(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t code = 0;
    if (argc > 0 && !JS_IsUndefined(argv[0]) && JS_ToInt32(ctx, &code, argv[0]))
        return JS_EXCEPTION;
    mr_quit(code);
    return JS_UNDEFINED;
}

static const JSCFunctionListEntry app_funcs[] = {
    JS_CFUNC_DEF("quit", 1, js_quit),
    JS_PROP_STRING_DEF("version", MR_VERSION, 0),
    JS_PROP_STRING_DEF("platform", MR_PLATFORM, 0),
};

static int app_init(JSContext *ctx, JSModuleDef *m)
{
    JSValue args = JS_NewArray(ctx);
    int i;
    for (i = 0; i < app_argc; i++)
        JS_SetPropertyUint32(ctx, args, i, JS_NewString(ctx, app_argv[i]));
    JS_SetModuleExport(ctx, m, "args", args);
    {
        gchar *dir = mr_app_data_dir();
        JS_SetModuleExport(ctx, m, "id", JS_NewString(ctx, mr_app_id()));
        JS_SetModuleExport(ctx, m, "dataDir", JS_NewString(ctx, dir));
        g_free(dir);
    }
    return JS_SetModuleExportList(ctx, m, app_funcs, G_N_ELEMENTS(app_funcs));
}

JSModuleDef *mr_init_app(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, app_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, app_funcs, G_N_ELEMENTS(app_funcs));
    JS_AddModuleExport(ctx, m, "args");
    JS_AddModuleExport(ctx, m, "id");
    JS_AddModuleExport(ctx, m, "dataDir");
    return m;
}
