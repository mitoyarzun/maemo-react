/* Shared declarations for maemo-react-host. */
#ifndef MR_H
#define MR_H

#include <glib-object.h>
#include <curl/curl.h>
#include "quickjs.h"

#define MR_VERSION "0.3.0"
#define MR_APPS_DIR "/opt/n810-modern/share/maemo-react/apps"

#ifdef MR_HILDON
#define MR_PLATFORM "hildon"
#else
#define MR_PLATFORM "desktop"
#endif

extern JSRuntime *mr_rt;
extern JSContext *mr_ctx;
extern int mr_test_mode;

/* loop.c */
void mr_loop_init(JSRuntime *rt);
JSValue mr_call(JSValueConst fn, JSValueConst this_val, int argc, JSValueConst *argv);
void mr_drain_jobs(void);
JSValue mr_eval_function(JSContext *ctx, JSValue fn);
void mr_report_exception(JSContext *ctx);
void mr_quit(int code);
int mr_quit_requested(void);
int mr_exit_code(void);
void mr_timers_init(JSContext *ctx);

/* console.c */
void mr_console_init(JSContext *ctx);
double mr_now_ms(void);

/* loader.c */
typedef JSModuleDef *(*mr_module_init_fn)(JSContext *ctx, const char *name);
void mr_register_module(const char *name, mr_module_init_fn init);
void mr_loader_init(JSRuntime *rt);
int mr_run_module_file(JSContext *ctx, const char *path);
int mr_compile_file(JSContext *ctx, const char *path);

/* bytecode.c */
gchar *mr_bc_path(const char *js_path);
uint8_t *mr_bc_read(const char *js_path, size_t *len);
int mr_bc_write(const char *js_path, const uint8_t *buf, size_t len);

/* app.c */
void mr_app_set_args(int argc, char **argv);
JSModuleDef *mr_init_app(JSContext *ctx, const char *name);
const char *mr_app_id(void);
gchar *mr_app_data_dir(void);

/* gtype.c */
GType mr_type_from_name(const char *name);

/* convert.c */
int mr_js_to_gvalue(JSContext *ctx, JSValueConst v, GValue *out, GParamSpec *ps, const char *what);
JSValue mr_gvalue_to_js(JSContext *ctx, const GValue *v, int strict);

/* bridge.c */
extern double mr_bridge_ms;
void mr_bridge_init(void);
JSModuleDef *mr_init_gobject(JSContext *ctx, const char *name);
GObject *mr_handle_object(int32_t h);
int32_t mr_handle_of(GObject *obj);
GObject *mr_arg_object(JSContext *ctx, JSValueConst v);
int mr_bridge_handle_count(void);
int32_t mr_handle_for(GObject *obj);

/* closure.c */
GClosure *mr_closure_new(JSContext *ctx, JSValueConst fn);
int mr_closure_count(void);

/* helpers.c */
JSValue mr_call_helper(JSContext *ctx, GObject *o, const char *name, int argc, JSValueConst *argv);

/* debug.c */
JSModuleDef *mr_init_debug(JSContext *ctx, const char *name);

/* curlm.c */
typedef struct MrCurlOwner MrCurlOwner;
struct MrCurlOwner {
    /* The transfer ended. Runs from the main loop; it may run JavaScript and free easy. */
    void (*done)(CURL *easy, CURLcode result, MrCurlOwner *owner);
};
CURLM *mr_curl_multi(void);
void mr_curl_add(CURL *easy, MrCurlOwner *owner);
void mr_curl_remove(CURL *easy);

/* http.c */
JSModuleDef *mr_init_http(JSContext *ctx, const char *name);

/* ws.c */
JSModuleDef *mr_init_ws(JSContext *ctx, const char *name);

/* storage.c */
JSModuleDef *mr_init_storage(JSContext *ctx, const char *name);
void mr_storage_flush(void);

#endif
