/* maemo-react-host: runs a React application module on GTK. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"

JSRuntime *mr_rt;
JSContext *mr_ctx;
int mr_test_mode;

static void usage(void)
{
    fprintf(stderr,
            "usage: maemo-react-host <module.js> [args...]\n"
            "       maemo-react-host --test <module.js> [args...]\n"
            "       maemo-react-host --compile <file.js>...\n");
    exit(2);
}

static gboolean test_timeout(gpointer data)
{
    fprintf(stderr, "TIMEOUT: the test did not call quit() in 120 s\n");
    exit(124);
    return FALSE;
}

/* The native modules. Compilation loads them to read their exports, so
   --compile and a normal run register the same list. */
static void register_modules(void)
{
    mr_loader_init(mr_rt);
    mr_register_module("maemo:app", mr_init_app);
    mr_bridge_init();
    mr_register_module("maemo:gobject", mr_init_gobject);
    mr_register_module("maemo:debug", mr_init_debug);
    mr_register_module("maemo:http", mr_init_http);
    mr_register_module("maemo:ws", mr_init_ws);
    mr_register_module("maemo:storage", mr_init_storage);
}

/* --compile needs no display: package scripts run it over SSH. */
static int compile_files(int argc, char **argv)
{
    int i, rc = 0;
    mr_rt = JS_NewRuntime();
    JS_SetStripInfo(mr_rt, JS_STRIP_SOURCE);
    JS_SetMaxStackSize(mr_rt, 1024 * 1024); /* the same as a normal run; a large bundle needs it */
    mr_ctx = JS_NewContext(mr_rt);
    mr_loop_init(mr_rt);
    register_modules();
    for (i = 2; i < argc; i++)
        if (mr_compile_file(mr_ctx, argv[i]) < 0)
            rc = 1;
    return rc;
}

/* The prelude: $MR_PRELUDE, or ../lib/maemo-react/prelude.js beside the binary. */
static gchar *prelude_path(void)
{
    const char *env = g_getenv("MR_PRELUDE");
    gchar *exe, *dir, *path;
    if (env)
        return g_strdup(env);
    exe = g_file_read_link("/proc/self/exe", NULL);
    if (!exe)
        return NULL;
    dir = g_path_get_dirname(exe);
    path = g_build_filename(dir, "..", "lib", "maemo-react", "prelude.js", NULL);
    g_free(exe);
    g_free(dir);
    return path;
}

int main(int argc, char **argv)
{
    int first = 1;

    if (argc < 2)
        usage();
    if (!strcmp(argv[1], "--compile")) {
        if (argc < 3)
            usage();
        return compile_files(argc, argv);
    }
    if (!strcmp(argv[1], "--test")) {
        mr_test_mode = 1;
        first = 2;
    }
    if (first >= argc)
        usage();

    if (!gtk_init_check(&argc, &argv)) {
        fprintf(stderr, "maemo-react-host: cannot open the display. "
                        "Set DISPLAY=:0, or start the application on the tablet.\n");
        return 1;
    }
    if (mr_test_mode) {
        /* In tests, a GTK critical warning is a failure. */
        g_log_set_always_fatal(G_LOG_LEVEL_CRITICAL);
        g_timeout_add(120000, test_timeout, NULL);
    }

    mr_rt = JS_NewRuntime();
    /* The same setting as --compile, so the caches are the same. */
    JS_SetStripInfo(mr_rt, JS_STRIP_SOURCE);
    JS_SetMaxStackSize(mr_rt, 1024 * 1024);
    mr_ctx = JS_NewContext(mr_rt);
    mr_loop_init(mr_rt);
    mr_console_init(mr_ctx);
    mr_timers_init(mr_ctx);
    register_modules();
    mr_app_set_args(argc - first, argv + first);

    {
        gchar *prelude = prelude_path();
        if (!prelude || !g_file_test(prelude, G_FILE_TEST_EXISTS)) {
            fprintf(stderr, "maemo-react-host: no prelude at %s\n", prelude ? prelude : "(unknown)");
            return 1;
        }
        if (mr_run_module_file(mr_ctx, prelude) < 0)
            return 1;
        g_free(prelude);
    }
    /* atexit covers every exit except a signal: the return after a throw in
       the application module, mr_quit and exit(). A change that waits for
       idle time must reach the file. */
    atexit(mr_storage_flush);
    if (mr_run_module_file(mr_ctx, argv[first]) < 0)
        return 1;
    if (!mr_quit_requested())
        gtk_main();
    /* Do not free the runtime: closures that GTK still holds keep JS
       objects, and JS_FreeRuntime asserts that none are left. */
    return mr_exit_code();
}
