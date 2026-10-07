/* maemo:gobject -- make GObjects and use their properties. A handle is an
   integer; the handle table holds one strong reference for each handle.
   Handles are never used again after a destroy. */
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"

static GHashTable *handles; /* handle -> GObject */
static GQuark handle_quark;
static int32_t next_handle = 1;
double mr_bridge_ms;

void mr_bridge_init(void)
{
    handles = g_hash_table_new(g_direct_hash, g_direct_equal);
    handle_quark = g_quark_from_static_string("maemo-react-handle");
}

GObject *mr_handle_object(int32_t h)
{
    return g_hash_table_lookup(handles, GINT_TO_POINTER(h));
}

int32_t mr_handle_of(GObject *obj)
{
    return GPOINTER_TO_INT(g_object_get_qdata(obj, handle_quark));
}

int mr_bridge_handle_count(void)
{
    return g_hash_table_size(handles);
}

GObject *mr_arg_object(JSContext *ctx, JSValueConst v)
{
    int32_t h;
    GObject *o = NULL;
    if (JS_IsNumber(v) && JS_ToInt32(ctx, &h, v) == 0)
        o = mr_handle_object(h);
    if (!o)
        JS_ThrowTypeError(ctx, "maemo:gobject: invalid handle");
    return o;
}

static int32_t add_handle(GObject *obj)
{
    int32_t h = next_handle++;
    g_hash_table_insert(handles, GINT_TO_POINTER(h), obj);
    g_object_set_qdata(obj, handle_quark, GINT_TO_POINTER(h));
    return h;
}

/* The handle of obj; a new one, with a new reference, when it has none. For
   objects that GTK made itself, for example a GtkTreeSelection. */
int32_t mr_handle_for(GObject *obj)
{
    int32_t h = mr_handle_of(obj);
    if (h)
        return h;
    g_object_ref(obj);
    return add_handle(obj);
}

/* Remove the handle of obj and give back the table's reference. */
static void release(GObject *obj)
{
    int32_t h = mr_handle_of(obj);
    if (!h)
        return;
    g_object_set_qdata(obj, handle_quark, NULL);
    g_hash_table_remove(handles, GINT_TO_POINTER(h));
    g_object_unref(obj);
}

static void release_tree(GtkWidget *w, gpointer data)
{
    if (GTK_IS_CONTAINER(w))
        gtk_container_forall(GTK_CONTAINER(w), release_tree, NULL);
    release(G_OBJECT(w));
}

static GParamSpec *find_property(JSContext *ctx, GObject *o, const char *name, gboolean write)
{
    GParamSpec *ps = g_object_class_find_property(G_OBJECT_GET_CLASS(o), name);
    if (!ps) {
        JS_ThrowTypeError(ctx, "%s has no property '%s'", G_OBJECT_TYPE_NAME(o), name);
        return NULL;
    }
    if (write && (!(ps->flags & G_PARAM_WRITABLE) || (ps->flags & G_PARAM_CONSTRUCT_ONLY))) {
        JS_ThrowTypeError(ctx, "property '%s' of %s is not writable", name, G_OBJECT_TYPE_NAME(o));
        return NULL;
    }
    if (!write && !(ps->flags & G_PARAM_READABLE)) {
        JS_ThrowTypeError(ctx, "property '%s' of %s is not readable", name, G_OBJECT_TYPE_NAME(o));
        return NULL;
    }
    return ps;
}

static JSValue js_create(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *name = JS_ToCString(ctx, argv[0]);
    GType t;
    GObject *o;
    if (!name)
        return JS_EXCEPTION;
    t = mr_type_from_name(name);
    if (!t || !G_TYPE_IS_OBJECT(t) || G_TYPE_IS_ABSTRACT(t)) {
        JS_ThrowTypeError(ctx, "'%s' is not a GObject type that can be created", name);
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    JS_FreeCString(ctx, name);
    o = g_object_new(t, NULL);
    if (g_object_is_floating(o))
        g_object_ref_sink(o); /* GtkObject starts floating; we own it now */
    else if (GTK_IS_WINDOW(o))
        g_object_ref(o); /* a window sinks itself; its own reference goes in gtk_widget_destroy */
    return JS_NewInt32(ctx, add_handle(o));
}

static JSValue js_set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double t0 = mr_now_ms();
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    gchar *what;
    int r;
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!(ps = find_property(ctx, o, name, TRUE))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    /* Convert with the short name. Build the full name "Type.property" only
       when the conversion fails: it then runs again to make the message. */
    r = mr_js_to_gvalue(ctx, argv[2], &v, ps, name);
    if (r != 0) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        what = g_strdup_printf("%s.%s", G_OBJECT_TYPE_NAME(o), name);
        g_value_reset(&v);
        r = mr_js_to_gvalue(ctx, argv[2], &v, ps, what);
        g_free(what);
    }
    if (r == 0)
        g_object_set_property(o, name, &v);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    mr_bridge_ms += mr_now_ms() - t0;
    return r == 0 ? JS_UNDEFINED : JS_EXCEPTION;
}

static JSValue js_get(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    JSValue r;
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!(ps = find_property(ctx, o, name, FALSE))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    g_object_get_property(o, name, &v);
    r = mr_gvalue_to_js(ctx, &v, 1);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    return r;
}

static JSValue js_reset(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double t0 = mr_now_ms();
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!(ps = find_property(ctx, o, name, TRUE))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    g_param_value_set_default(ps, &v);
    g_object_set_property(o, name, &v);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    mr_bridge_ms += mr_now_ms() - t0;
    return JS_UNDEFINED;
}

static JSValue js_destroy(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int32_t h;
    GObject *o;
    if (!JS_IsNumber(argv[0]) || JS_ToInt32(ctx, &h, argv[0]))
        return JS_ThrowTypeError(ctx, "maemo:gobject: invalid handle");
    o = mr_handle_object(h);
    if (!o)
        return JS_UNDEFINED; /* destroyed already */
    g_object_ref(o);
    if (GTK_IS_CONTAINER(o))
        gtk_container_forall(GTK_CONTAINER(o), release_tree, NULL);
    /* A GtkMenu lives in its own popup window, which holds a reference to it.
       Only gtk_widget_destroy frees both. */
    if (GTK_IS_WIDGET(o) && (GTK_WIDGET_TOPLEVEL(GTK_WIDGET(o)) || GTK_IS_MENU(o)))
        gtk_widget_destroy(GTK_WIDGET(o));
    release(o);
    g_object_unref(o);
    return JS_UNDEFINED;
}

static JSValue js_connect(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    guint id;
    GQuark detail;
    gulong hid;
    if (!o)
        return JS_EXCEPTION;
    if (!JS_IsFunction(ctx, argv[2]))
        return JS_ThrowTypeError(ctx, "connect: the handler must be a function");
    if (!(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    if (!g_signal_parse_name(name, G_OBJECT_TYPE(o), &id, &detail, TRUE)) {
        JS_ThrowTypeError(ctx, "%s has no signal '%s'", G_OBJECT_TYPE_NAME(o), name);
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    JS_FreeCString(ctx, name);
    hid = g_signal_connect_closure_by_id(o, id, detail, mr_closure_new(ctx, argv[2]), FALSE);
    return JS_NewInt64(ctx, hid);
}

static GParamSpec *find_child_property(JSContext *ctx, GObject *parent, GObject *child, const char *name)
{
    GParamSpec *ps;
    if (!GTK_IS_CONTAINER(parent)) {
        JS_ThrowTypeError(ctx, "%s is not a container", G_OBJECT_TYPE_NAME(parent));
        return NULL;
    }
    if (!GTK_IS_WIDGET(child) || gtk_widget_get_parent(GTK_WIDGET(child)) != GTK_WIDGET(parent)) {
        JS_ThrowTypeError(ctx, "the %s is not a child of the %s", G_OBJECT_TYPE_NAME(child),
                          G_OBJECT_TYPE_NAME(parent));
        return NULL;
    }
    ps = gtk_container_class_find_child_property(G_OBJECT_GET_CLASS(parent), name);
    if (!ps)
        JS_ThrowTypeError(ctx, "%s has no child property '%s'", G_OBJECT_TYPE_NAME(parent), name);
    return ps;
}

static JSValue js_child_set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double t0 = mr_now_ms();
    GObject *parent = mr_arg_object(ctx, argv[0]);
    GObject *child = parent ? mr_arg_object(ctx, argv[1]) : NULL;
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    int r;
    if (!child || !(name = JS_ToCString(ctx, argv[2])))
        return JS_EXCEPTION;
    if (!(ps = find_child_property(ctx, parent, child, name))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    r = mr_js_to_gvalue(ctx, argv[3], &v, ps, name);
    if (r == 0)
        gtk_container_child_set_property(GTK_CONTAINER(parent), GTK_WIDGET(child), name, &v);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    mr_bridge_ms += mr_now_ms() - t0;
    return r == 0 ? JS_UNDEFINED : JS_EXCEPTION;
}

static JSValue js_child_get(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *parent = mr_arg_object(ctx, argv[0]);
    GObject *child = parent ? mr_arg_object(ctx, argv[1]) : NULL;
    const char *name;
    GParamSpec *ps;
    GValue v = { 0 };
    JSValue r;
    if (!child || !(name = JS_ToCString(ctx, argv[2])))
        return JS_EXCEPTION;
    if (!(ps = find_child_property(ctx, parent, child, name))) {
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    g_value_init(&v, G_PARAM_SPEC_VALUE_TYPE(ps));
    gtk_container_child_get_property(GTK_CONTAINER(parent), GTK_WIDGET(child), name, &v);
    r = mr_gvalue_to_js(ctx, &v, 1);
    g_value_unset(&v);
    JS_FreeCString(ctx, name);
    return r;
}

static JSValue js_call(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    GObject *o = mr_arg_object(ctx, argv[0]);
    const char *name;
    JSValue r;
    if (!o || !(name = JS_ToCString(ctx, argv[1])))
        return JS_EXCEPTION;
    g_object_ref(o); /* a helper can emit a signal whose handler destroys o */
    r = mr_call_helper(ctx, o, name, argc > 2 ? argc - 2 : 0, argv + 2);
    g_object_unref(o);
    JS_FreeCString(ctx, name);
    return r;
}

static const JSCFunctionListEntry gobject_funcs[] = {
    JS_CFUNC_DEF("create", 1, js_create),
    JS_CFUNC_DEF("set", 3, js_set),
    JS_CFUNC_DEF("get", 2, js_get),
    JS_CFUNC_DEF("reset", 2, js_reset),
    JS_CFUNC_DEF("connect", 3, js_connect),
    JS_CFUNC_DEF("childSet", 4, js_child_set),
    JS_CFUNC_DEF("childGet", 3, js_child_get),
    JS_CFUNC_DEF("call", 2, js_call),
    JS_CFUNC_DEF("destroy", 1, js_destroy),
};

static int gobject_init(JSContext *ctx, JSModuleDef *m)
{
    return JS_SetModuleExportList(ctx, m, gobject_funcs, G_N_ELEMENTS(gobject_funcs));
}

JSModuleDef *mr_init_gobject(JSContext *ctx, const char *name)
{
    JSModuleDef *m = JS_NewCModule(ctx, name, gobject_init);
    if (!m)
        return NULL;
    JS_AddModuleExportList(ctx, m, gobject_funcs, G_N_ELEMENTS(gobject_funcs));
    return m;
}
