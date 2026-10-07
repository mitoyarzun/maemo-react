/* maemo:storage -- the file behind localStorage. The prelude keeps the items
   in memory and gives this module a function that makes the JSON text. The
   module calls it during idle time after a change, and writes the file with
   a temporary file and rename, mode 0600 (HA spec section 5). */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "mr.h"

#define FILE_NAME "localStorage.json"

static JSValue make_text = JS_UNDEFINED; /* the pending function, or undefined */
static guint save_source;

static gchar *file_path(void)
{
    gchar *dir = mr_app_data_dir();
    gchar *path = g_build_filename(dir, FILE_NAME, NULL);
    g_free(dir);
    return path;
}

static void complain(const char *what, const char *path)
{
    fprintf(stderr, "localStorage: cannot %s %s: %s\n", what, path, g_strerror(errno));
}

/* Write text to path through path.tmp and rename, so a reader sees the old
   file or the new one, never a part. */
static int write_file(const char *path, const char *text, size_t len)
{
    gchar *dir = g_path_get_dirname(path);
    gchar *tmp = g_strconcat(path, ".tmp", NULL);
    size_t off = 0;
    int fd, rc = -1;
    if (g_mkdir_with_parents(dir, 0700) < 0) {
        complain("make the folder", dir);
        goto out;
    }
    fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0600);
    if (fd < 0) {
        complain("open", tmp);
        goto out;
    }
    fchmod(fd, 0600); /* an old temporary file keeps its mode through O_CREAT */
    while (off < len) {
        ssize_t n = write(fd, text + off, len - off);
        if (n < 0 && errno == EINTR)
            continue;
        if (n < 0) {
            complain("write", tmp);
            close(fd);
            unlink(tmp);
            goto out;
        }
        off += (size_t)n;
    }
    /* The file holds a token. A power loss must not leave an empty file
       after the rename, so write the data to the disk first. */
    if (fsync(fd) < 0) {
        complain("sync", tmp);
        close(fd);
        unlink(tmp);
        goto out;
    }
    if (close(fd) < 0) {
        complain("close", tmp);
        unlink(tmp);
        goto out;
    }
    if (rename(tmp, path) < 0) {
        complain("rename", tmp);
        unlink(tmp);
        goto out;
    }
    rc = 0;
out:
    g_free(dir);
    g_free(tmp);
    return rc;
}

/* Call the pending function and write its result. When the write fails, the
   function stays pending, so the flush at exit tries again. */
static void save_now(void)
{
    JSValue fn, text;
    const char *s;
    size_t len = 0;
    if (JS_IsUndefined(make_text))
        return;
    fn = make_text;
    make_text = JS_UNDEFINED;
    text = mr_call(fn, JS_UNDEFINED, 0, NULL);
    s = JS_IsString(text) ? JS_ToCStringLen(mr_ctx, &len, text) : NULL;
    if (s) {
        gchar *path = file_path();
        if (write_file(path, s, len) < 0)
            make_text = JS_DupValue(mr_ctx, fn); /* keep it for the retry */
        g_free(path);
        JS_FreeCString(mr_ctx, s);
    }
    JS_FreeValue(mr_ctx, text);
    JS_FreeValue(mr_ctx, fn);
}

static gboolean on_idle(gpointer data)
{
    save_source = 0;
    save_now();
    return FALSE;
}

void mr_storage_flush(void)
{
    if (save_source) {
        g_source_remove(save_source);
        save_source = 0;
    }
    save_now();
}

/* schedule(fn): call fn during idle time, after the paint, and write its
   result. The last function wins when several come before the idle. */
static JSValue js_schedule(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 1 || !JS_IsFunction(ctx, argv[0]))
        return JS_ThrowTypeError(ctx, "schedule: the argument must be a function");
    JS_FreeValue(ctx, make_text);
    make_text = JS_DupValue(ctx, argv[0]);
    /* G_PRIORITY_LOW runs after the GTK redraw (G_PRIORITY_HIGH_IDLE + 20). */
    if (!save_source)
        save_source = g_idle_add_full(G_PRIORITY_LOW, on_idle, NULL, NULL);
    return JS_UNDEFINED;
}

/* load(): the text of the file, or null when there is none. Repairs the mode. */
static JSValue js_load(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *path = file_path();
    gchar *text = NULL;
    gsize len = 0;
    GError *err = NULL;
    struct stat st;
    JSValue r;
    /* lstat, so a symbolic link is never followed by the chmod. */
    if (lstat(path, &st) == 0 && S_ISREG(st.st_mode) && (st.st_mode & 077))
        chmod(path, 0600);
    if (g_file_get_contents(path, &text, &len, &err)) {
        r = JS_NewStringLen(ctx, text, len);
        g_free(text);
    } else {
        if (err->code != G_FILE_ERROR_NOENT)
            fprintf(stderr, "localStorage: cannot read %s: %s\n", path, err->message);
        g_error_free(err);
        r = JS_NULL;
    }
    g_free(path);
    return r;
}

/* markBad(): keep a file that cannot be read as localStorage.json.bad. */
static JSValue js_mark_bad(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *path = file_path();
    gchar *bad = g_strconcat(path, ".bad", NULL);
    if (rename(path, bad) < 0 && errno != ENOENT)
        complain("rename", path);
    g_free(bad);
    g_free(path);
    return JS_UNDEFINED;
}

/* flush(): write now. For tests, and for an application that is about to quit. */
static JSValue js_flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    mr_storage_flush();
    return JS_UNDEFINED;
}

/* path(): the file path. For tests. */
static JSValue js_path(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    gchar *path = file_path();
    JSValue r = JS_NewString(ctx, path);
    g_free(path);
    return r;
}

static const JSCFunctionListEntry storage_funcs[] = {
    JS_CFUNC_DEF("load", 0, js_load),
    JS_CFUNC_DEF("schedule", 1, js_schedule),
    JS_CFUNC_DEF("markBad", 0, js_mark_bad),
    JS_CFUNC_DEF("flush", 0, js_flush),
    JS_CFUNC_DEF("path", 0, js_path),
};

static int storage_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, storage_funcs, G_N_ELEMENTS(storage_funcs));
}

JSModuleDef *mr_init_storage(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, storage_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, storage_funcs, G_N_ELEMENTS(storage_funcs));
    return m;
}
