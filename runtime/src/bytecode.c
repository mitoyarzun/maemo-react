/* Bytecode cache files: app.js gets app.qbc beside it. A header records the
   QuickJS and maemo-react versions and the size and time of the source, so a
   changed source or a new runtime makes the cache stale. */
#include <string.h>
#include <sys/stat.h>
#include "mr.h"

#define BC_MAGIC "MRBC"
#define BC_FORMAT 1

typedef struct {
    char magic[4];
    guint32 format;
    char qjs[16];
    char mr[16];
    guint32 src_size;
    guint32 src_mtime;
} BcHeader; /* 48 bytes, no padding */

static void make_header(BcHeader *h, const struct stat *st)
{
    memset(h, 0, sizeof *h);
    memcpy(h->magic, BC_MAGIC, 4);
    h->format = BC_FORMAT;
    g_strlcpy(h->qjs, MR_QJS_VERSION, sizeof h->qjs);
    g_strlcpy(h->mr, MR_VERSION, sizeof h->mr);
    h->src_size = (guint32)st->st_size;
    h->src_mtime = (guint32)st->st_mtime;
}

gchar *mr_bc_path(const char *js_path)
{
    size_t n = strlen(js_path);
    if (n > 3 && g_str_has_suffix(js_path, ".js")) {
        gchar *stem = g_strndup(js_path, n - 3);
        gchar *p = g_strconcat(stem, ".qbc", NULL);
        g_free(stem);
        return p;
    }
    return g_strconcat(js_path, ".qbc", NULL);
}

uint8_t *mr_bc_read(const char *js_path, size_t *len)
{
    struct stat st;
    BcHeader want;
    gchar *path, *data;
    gsize n;
    if (stat(js_path, &st) < 0)
        return NULL;
    make_header(&want, &st);
    path = mr_bc_path(js_path);
    if (!g_file_get_contents(path, &data, &n, NULL)) {
        g_free(path);
        return NULL;
    }
    g_free(path);
    if (n <= sizeof want || memcmp(data, &want, sizeof want) != 0) {
        g_free(data);
        return NULL;
    }
    memmove(data, data + sizeof want, n - sizeof want);
    *len = n - sizeof want;
    return (uint8_t *)data;
}

int mr_bc_write(const char *js_path, const uint8_t *buf, size_t len)
{
    struct stat st;
    BcHeader h;
    gchar *path, *all;
    gboolean ok;
    if (stat(js_path, &st) < 0)
        return -1;
    make_header(&h, &st);
    all = g_malloc(sizeof h + len);
    memcpy(all, &h, sizeof h);
    memcpy(all + sizeof h, buf, len);
    path = mr_bc_path(js_path);
    /* Writes a temporary file and renames it, so a reader never sees half. */
    ok = g_file_set_contents(path, all, sizeof h + len, NULL);
    g_free(path);
    g_free(all);
    return ok ? 0 : -1;
}
