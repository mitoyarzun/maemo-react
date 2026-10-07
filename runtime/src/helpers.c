/* call() helpers: GTK functions that are not properties or signals. */
#include <string.h>
#include <stdio.h>
#include <gtk/gtk.h>
#ifdef MR_HILDON
#include <hildon/hildon-banner.h>
#include <hildon/hildon-program.h>
#include <hildon/hildon-window.h>
#endif
#include "mr.h"

typedef JSValue (*HelperFn)(JSContext *ctx, GObject *o, int argc, JSValueConst *argv);

static GtkWidget *arg_widget(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper)
{
    GObject *o;
    if (i >= argc) {
        JS_ThrowTypeError(ctx, "%s: missing argument %d", helper, i + 1);
        return NULL;
    }
    if (!(o = mr_arg_object(ctx, argv[i])))
        return NULL;
    if (!GTK_IS_WIDGET(o)) {
        JS_ThrowTypeError(ctx, "%s: expected a widget, got a %s", helper, G_OBJECT_TYPE_NAME(o));
        return NULL;
    }
    return GTK_WIDGET(o);
}

static JSValue h_container_add(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "container.add");
    if (!child)
        return JS_EXCEPTION;
    if (gtk_widget_get_parent(child))
        return JS_ThrowTypeError(ctx, "container.add: the %s has a parent already", G_OBJECT_TYPE_NAME(child));
    gtk_container_add(GTK_CONTAINER(o), child);
    return JS_UNDEFINED;
}

static JSValue h_container_index_of(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "container.indexOf");
    GList *list;
    int i;
    if (!child)
        return JS_EXCEPTION;
    list = gtk_container_get_children(GTK_CONTAINER(o));
    i = g_list_index(list, child);
    g_list_free(list);
    return JS_NewInt32(ctx, i);
}

static JSValue h_box_reorder(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "box.reorder");
    int32_t pos;
    if (!child)
        return JS_EXCEPTION;
    if (argc < 2 || !JS_IsNumber(argv[1]) || JS_ToInt32(ctx, &pos, argv[1]))
        return JS_ThrowTypeError(ctx, "box.reorder: the position must be a number");
    gtk_box_reorder_child(GTK_BOX(o), child, pos);
    return JS_UNDEFINED;
}

static JSValue h_scrolled_add(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "scrolled.add");
    if (!child)
        return JS_EXCEPTION;
    /* Tree views and text views scroll by themselves; others need a viewport. */
    if (GTK_WIDGET_GET_CLASS(child)->set_scroll_adjustments_signal)
        gtk_container_add(GTK_CONTAINER(o), child);
    else
        gtk_scrolled_window_add_with_viewport(GTK_SCROLLED_WINDOW(o), child);
    return JS_UNDEFINED;
}

static JSValue h_remove_from_parent(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *w = GTK_WIDGET(o);
    GtkWidget *parent = gtk_widget_get_parent(w);
    GtkWidget *grand;
    if (!parent)
        return JS_UNDEFINED;
    grand = gtk_widget_get_parent(parent);
    gtk_container_remove(GTK_CONTAINER(parent), w);
    /* Remove the viewport that scrolled.add made, so the scrolled window is
       empty again. */
    if (GTK_IS_VIEWPORT(parent) && grand && GTK_IS_SCROLLED_WINDOW(grand))
        gtk_container_remove(GTK_CONTAINER(grand), parent);
    return JS_UNDEFINED;
}

static JSValue h_show(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_widget_show(GTK_WIDGET(o));
    return JS_UNDEFINED;
}

static JSValue h_hide(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_widget_hide(GTK_WIDGET(o));
    return JS_UNDEFINED;
}

static JSValue h_button_clicked(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_button_clicked(GTK_BUTTON(o));
    return JS_UNDEFINED;
}

static JSValue h_register_program(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
#ifdef MR_HILDON
    if (HILDON_IS_WINDOW(o))
        hildon_program_add_window(hildon_program_get_instance(), HILDON_WINDOW(o));
#else
    /* The desktop dev host: the size of the tablet's screen. */
    gtk_window_set_default_size(GTK_WINDOW(o), 800, 480);
#endif
    return JS_UNDEFINED;
}

/* Read argument i as an integer. */
static int arg_int(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper, int32_t *out)
{
    if (i >= argc || !JS_IsNumber(argv[i]) || JS_ToInt32(ctx, out, argv[i])) {
        JS_ThrowTypeError(ctx, "%s: argument %d must be a number", helper, i + 1);
        return -1;
    }
    return 0;
}

/* The length of the array in argument i; -1 and a TypeError if it is not an array. */
static int arg_array_length(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper, uint32_t *len)
{
    JSValue lenv;
    if (i >= argc || !JS_IsArray(ctx, argv[i])) {
        JS_ThrowTypeError(ctx, "%s: argument %d must be an array", helper, i + 1);
        return -1;
    }
    lenv = JS_GetPropertyStr(ctx, argv[i], "length");
    JS_ToUint32(ctx, len, lenv);
    JS_FreeValue(ctx, lenv);
    return 0;
}

static GtkCellRenderer *arg_renderer(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper)
{
    GObject *r;
    if (i >= argc) {
        JS_ThrowTypeError(ctx, "%s: missing argument %d", helper, i + 1);
        return NULL;
    }
    if (!(r = mr_arg_object(ctx, argv[i])))
        return NULL;
    if (!GTK_IS_CELL_RENDERER(r)) {
        JS_ThrowTypeError(ctx, "%s: expected a cell renderer, got a %s", helper, G_OBJECT_TYPE_NAME(r));
        return NULL;
    }
    return GTK_CELL_RENDERER(r);
}

/* The iter of row index; a RangeError when there is no such row. */
static int row_iter(JSContext *ctx, GtkTreeModel *model, int32_t index, GtkTreeIter *iter, const char *helper)
{
    if (index < 0 || !gtk_tree_model_iter_nth_child(model, iter, NULL, index)) {
        JS_ThrowRangeError(ctx, "%s: no row %d", helper, (int)index);
        return -1;
    }
    return 0;
}

/* Initialise out with the type of store column col and convert v into it. */
static int cell_value(JSContext *ctx, GtkTreeModel *model, int32_t col, JSValueConst v, GValue *out, const char *helper)
{
    if (col < 0 || col >= gtk_tree_model_get_n_columns(model)) {
        JS_ThrowRangeError(ctx, "%s: no column %d", helper, (int)col);
        return -1;
    }
    g_value_init(out, gtk_tree_model_get_column_type(model, col));
    return mr_js_to_gvalue(ctx, v, out, NULL, helper);
}

static JSValue h_list_store_set_column_types(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    uint32_t n, i;
    GType *types;
    int bad = 0;
    if (arg_array_length(ctx, argc, argv, 0, "listStore.setColumnTypes", &n))
        return JS_EXCEPTION;
    if (n == 0)
        return JS_ThrowTypeError(ctx, "listStore.setColumnTypes: give at least one column");
    types = g_new0(GType, n);
    for (i = 0; i < n && !bad; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[0], i);
        const char *s = JS_IsString(item) ? JS_ToCString(ctx, item) : NULL;
        if (s && !strcmp(s, "string"))
            types[i] = G_TYPE_STRING;
        else if (s && !strcmp(s, "boolean"))
            types[i] = G_TYPE_BOOLEAN;
        else if (s && !strcmp(s, "number"))
            types[i] = G_TYPE_DOUBLE;
        else {
            JS_ThrowTypeError(ctx, "listStore.setColumnTypes: column %u is not 'string', 'boolean' or 'number'", i);
            bad = 1;
        }
        if (s)
            JS_FreeCString(ctx, s);
        JS_FreeValue(ctx, item);
    }
    if (!bad)
        gtk_list_store_set_column_types(GTK_LIST_STORE(o), n, types);
    g_free(types);
    return bad ? JS_EXCEPTION : JS_UNDEFINED;
}

static JSValue h_list_store_insert(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    gint n = gtk_tree_model_get_n_columns(model), i;
    int32_t index;
    uint32_t len;
    gint *columns;
    GValue *values;
    GtkTreeIter iter;
    int bad = 0;
    if (arg_int(ctx, argc, argv, 0, "listStore.insert", &index))
        return JS_EXCEPTION;
    if (arg_array_length(ctx, argc, argv, 1, "listStore.insert", &len))
        return JS_EXCEPTION;
    if ((gint)len != n)
        return JS_ThrowTypeError(ctx, "listStore.insert: the row has %u values, the store has %d columns", len, n);
    columns = g_new(gint, n);
    values = g_new0(GValue, n);
    for (i = 0; i < n && !bad; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[1], i);
        columns[i] = i;
        bad = cell_value(ctx, model, i, item, &values[i], "listStore.insert") < 0;
        JS_FreeValue(ctx, item);
    }
    if (!bad) /* one row-inserted signal for the whole row */
        gtk_list_store_insert_with_valuesv(GTK_LIST_STORE(o), &iter, index < 0 ? G_MAXINT : index, columns, values, n);
    for (i = 0; i < n; i++)
        if (G_IS_VALUE(&values[i]))
            g_value_unset(&values[i]);
    g_free(values);
    g_free(columns);
    return bad ? JS_EXCEPTION : JS_UNDEFINED;
}

static JSValue h_list_store_set(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    int32_t index, col;
    GtkTreeIter iter;
    GValue v = { 0 };
    if (arg_int(ctx, argc, argv, 0, "listStore.set", &index) || arg_int(ctx, argc, argv, 1, "listStore.set", &col))
        return JS_EXCEPTION;
    if (argc < 3)
        return JS_ThrowTypeError(ctx, "listStore.set: give the value");
    if (row_iter(ctx, model, index, &iter, "listStore.set"))
        return JS_EXCEPTION;
    if (cell_value(ctx, model, col, argv[2], &v, "listStore.set") < 0) {
        if (G_IS_VALUE(&v))
            g_value_unset(&v);
        return JS_EXCEPTION;
    }
    gtk_list_store_set_value(GTK_LIST_STORE(o), &iter, col, &v);
    g_value_unset(&v);
    return JS_UNDEFINED;
}

static JSValue h_list_store_get(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    int32_t index, col;
    GtkTreeIter iter;
    GValue v = { 0 };
    JSValue r;
    if (arg_int(ctx, argc, argv, 0, "listStore.get", &index) || arg_int(ctx, argc, argv, 1, "listStore.get", &col))
        return JS_EXCEPTION;
    if (row_iter(ctx, model, index, &iter, "listStore.get"))
        return JS_EXCEPTION;
    if (col < 0 || col >= gtk_tree_model_get_n_columns(model))
        return JS_ThrowRangeError(ctx, "listStore.get: no column %d", (int)col);
    gtk_tree_model_get_value(model, &iter, col, &v);
    r = mr_gvalue_to_js(ctx, &v, 1);
    g_value_unset(&v);
    return r;
}

static JSValue h_list_store_remove(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    int32_t index;
    GtkTreeIter iter;
    if (arg_int(ctx, argc, argv, 0, "listStore.remove", &index))
        return JS_EXCEPTION;
    if (row_iter(ctx, GTK_TREE_MODEL(o), index, &iter, "listStore.remove"))
        return JS_EXCEPTION;
    gtk_list_store_remove(GTK_LIST_STORE(o), &iter);
    return JS_UNDEFINED;
}

static JSValue h_list_store_move(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model = GTK_TREE_MODEL(o);
    int32_t from, to;
    GtkTreeIter a, b;
    if (arg_int(ctx, argc, argv, 0, "listStore.move", &from) || arg_int(ctx, argc, argv, 1, "listStore.move", &to))
        return JS_EXCEPTION;
    if (row_iter(ctx, model, from, &a, "listStore.move") || row_iter(ctx, model, to, &b, "listStore.move"))
        return JS_EXCEPTION;
    /* After the move, the row from 'from' is at index 'to'. */
    if (from > to)
        gtk_list_store_move_before(GTK_LIST_STORE(o), &a, &b);
    else if (from < to)
        gtk_list_store_move_after(GTK_LIST_STORE(o), &a, &b);
    return JS_UNDEFINED;
}

static JSValue h_list_store_clear(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gtk_list_store_clear(GTK_LIST_STORE(o));
    return JS_UNDEFINED;
}

static JSValue h_list_store_length(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    return JS_NewInt32(ctx, gtk_tree_model_iter_n_children(GTK_TREE_MODEL(o), NULL));
}

static JSValue h_tree_view_append_column(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GObject *col;
    if (argc < 1 || !(col = mr_arg_object(ctx, argv[0])))
        return JS_EXCEPTION;
    if (!GTK_IS_TREE_VIEW_COLUMN(col))
        return JS_ThrowTypeError(ctx, "treeView.appendColumn: expected a GtkTreeViewColumn, got a %s", G_OBJECT_TYPE_NAME(col));
    return JS_NewInt32(ctx, gtk_tree_view_append_column(GTK_TREE_VIEW(o), GTK_TREE_VIEW_COLUMN(col)));
}

static JSValue h_tree_view_selection(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    return JS_NewInt32(ctx, mr_handle_for(G_OBJECT(gtk_tree_view_get_selection(GTK_TREE_VIEW(o)))));
}

static JSValue h_tree_view_selected_index(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeModel *model;
    GtkTreeIter iter;
    GtkTreePath *path;
    gint i;
    if (!gtk_tree_selection_get_selected(gtk_tree_view_get_selection(GTK_TREE_VIEW(o)), &model, &iter))
        return JS_NewInt32(ctx, -1);
    path = gtk_tree_model_get_path(model, &iter);
    i = gtk_tree_path_get_indices(path)[0];
    gtk_tree_path_free(path);
    return JS_NewInt32(ctx, i);
}

static JSValue h_tree_view_select_index(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkTreeSelection *sel = gtk_tree_view_get_selection(GTK_TREE_VIEW(o));
    GtkTreeModel *model = gtk_tree_view_get_model(GTK_TREE_VIEW(o));
    GtkTreeIter iter;
    int32_t index;
    if (arg_int(ctx, argc, argv, 0, "treeView.selectIndex", &index))
        return JS_EXCEPTION;
    if (index < 0 || !model) {
        gtk_tree_selection_unselect_all(sel);
        return JS_UNDEFINED;
    }
    if (row_iter(ctx, model, index, &iter, "treeView.selectIndex"))
        return JS_EXCEPTION;
    gtk_tree_selection_select_iter(sel, &iter);
    {
        /* Show the row: it can be off-screen in a long list. */
        GtkTreePath *path = gtk_tree_model_get_path(model, &iter);
        if (path) {
            gtk_tree_view_scroll_to_cell(GTK_TREE_VIEW(o), path, NULL, FALSE, 0.0f, 0.0f);
            gtk_tree_path_free(path);
        }
    }
    return JS_UNDEFINED;
}

static JSValue h_tree_view_renderer(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    int32_t index;
    GtkTreeViewColumn *col;
    GList *cells;
    int32_t h;
    if (arg_int(ctx, argc, argv, 0, "treeView.renderer", &index))
        return JS_EXCEPTION;
    col = index < 0 ? NULL : gtk_tree_view_get_column(GTK_TREE_VIEW(o), index);
    if (!col)
        return JS_ThrowRangeError(ctx, "treeView.renderer: no column %d", (int)index);
    cells = gtk_tree_view_column_get_cell_renderers(col);
    if (!cells)
        return JS_ThrowRangeError(ctx, "treeView.renderer: column %d has no renderer", (int)index);
    h = mr_handle_for(G_OBJECT(cells->data));
    g_list_free(cells);
    return JS_NewInt32(ctx, h);
}

static JSValue h_column_pack(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkCellRenderer *r = arg_renderer(ctx, argc, argv, 0, "column.pack");
    if (!r)
        return JS_EXCEPTION;
    gtk_tree_view_column_pack_start(GTK_TREE_VIEW_COLUMN(o), r, TRUE);
    return JS_UNDEFINED;
}

static JSValue h_column_add_attribute(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkCellRenderer *r = arg_renderer(ctx, argc, argv, 0, "column.addAttribute");
    const char *attr;
    int32_t col;
    if (!r)
        return JS_EXCEPTION;
    if (argc < 2 || !JS_IsString(argv[1]))
        return JS_ThrowTypeError(ctx, "column.addAttribute: argument 2 must be the property name");
    if (arg_int(ctx, argc, argv, 2, "column.addAttribute", &col))
        return JS_EXCEPTION;
    attr = JS_ToCString(ctx, argv[1]);
    gtk_tree_view_column_add_attribute(GTK_TREE_VIEW_COLUMN(o), r, attr, col);
    JS_FreeCString(ctx, attr);
    return JS_UNDEFINED;
}

/* Read argument i as a double. */
static int arg_double(JSContext *ctx, int argc, JSValueConst *argv, int i, const char *helper, double *out)
{
    if (i >= argc || !JS_IsNumber(argv[i]) || JS_ToFloat64(ctx, out, argv[i])) {
        JS_ThrowTypeError(ctx, "%s: argument %d must be a number", helper, i + 1);
        return -1;
    }
    return 0;
}

static JSValue h_range_set_range(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    double lo, hi;
    if (arg_double(ctx, argc, argv, 0, "range.setRange", &lo) || arg_double(ctx, argc, argv, 1, "range.setRange", &hi))
        return JS_EXCEPTION;
    if (!(lo < hi)) /* gtk_range_set_range prints a critical warning otherwise */
        return JS_ThrowRangeError(ctx, "range.setRange: min must be less than max");
    gtk_range_set_range(GTK_RANGE(o), lo, hi);
    return JS_UNDEFINED;
}

static JSValue h_range_set_increments(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    double step, page;
    if (arg_double(ctx, argc, argv, 0, "range.setIncrements", &step) || arg_double(ctx, argc, argv, 1, "range.setIncrements", &page))
        return JS_EXCEPTION;
    gtk_range_set_increments(GTK_RANGE(o), step, page);
    return JS_UNDEFINED;
}

static JSValue h_range_set_value(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    double v;
    if (arg_double(ctx, argc, argv, 0, "range.setValue", &v))
        return JS_EXCEPTION;
    gtk_range_set_value(GTK_RANGE(o), v); /* clamps to the range */
    return JS_UNDEFINED;
}

static JSValue h_range_get_value(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    return JS_NewFloat64(ctx, gtk_range_get_value(GTK_RANGE(o)));
}

static JSValue h_combo_set_items(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkComboBox *combo = GTK_COMBO_BOX(o);
    GtkTreeModel *model = gtk_combo_box_get_model(combo);
    uint32_t n, i;
    int bad = 0;
    if (arg_array_length(ctx, argc, argv, 0, "comboBox.setItems", &n))
        return JS_EXCEPTION;
    if (!model || !GTK_IS_LIST_STORE(model) || gtk_tree_model_get_n_columns(model) != 1
        || gtk_tree_model_get_column_type(model, 0) != G_TYPE_STRING) {
        /* What gtk_combo_box_new_text does. g_object_new made this combo box
           without a model, and GTK 2.10 has no GtkComboBoxText. */
        GtkListStore *store = gtk_list_store_new(1, G_TYPE_STRING);
        GtkCellRenderer *cell = gtk_cell_renderer_text_new();
        gtk_combo_box_set_model(combo, GTK_TREE_MODEL(store));
        g_object_unref(store);
        gtk_cell_layout_clear(GTK_CELL_LAYOUT(combo));
        gtk_cell_layout_pack_start(GTK_CELL_LAYOUT(combo), cell, TRUE);
        gtk_cell_layout_add_attribute(GTK_CELL_LAYOUT(combo), cell, "text", 0);
    } else {
        /* GTK 2.10 does not emit "changed" when the clear drops the active row.
           Reset the active row first, so the signal fires. */
        gtk_combo_box_set_active(combo, -1);
        gtk_list_store_clear(GTK_LIST_STORE(model));
    }
    for (i = 0; i < n && !bad; i++) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[0], i);
        const char *s = JS_IsString(item) ? JS_ToCString(ctx, item) : NULL;
        if (s)
            gtk_combo_box_append_text(combo, s);
        else {
            JS_ThrowTypeError(ctx, "comboBox.setItems: item %u is not a string", i);
            bad = 1;
        }
        if (s)
            JS_FreeCString(ctx, s);
        JS_FreeValue(ctx, item);
    }
    return bad ? JS_EXCEPTION : JS_UNDEFINED;
}

static JSValue h_combo_active_text(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    gchar *s = gtk_combo_box_get_active_text(GTK_COMBO_BOX(o));
    JSValue r = s ? JS_NewString(ctx, s) : JS_NULL;
    g_free(s);
    return r;
}

static JSValue h_menu_reorder(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *child = arg_widget(ctx, argc, argv, 0, "menu.reorder");
    int32_t pos;
    if (!child)
        return JS_EXCEPTION;
    if (arg_int(ctx, argc, argv, 1, "menu.reorder", &pos))
        return JS_EXCEPTION;
    gtk_menu_reorder_child(GTK_MENU(o), child, pos); /* a negative position appends */
    return JS_UNDEFINED;
}

/* The desktop dev host has no Hildon menu key: the window menu pops up on a
   right click in the window. The slot holds a weak pointer to the menu. GLib
   clears it when the menu is finalized, so the window never keeps a freed menu. */
typedef struct {
    GtkWidget *menu;
} MenuSlot;

static void menu_slot_free(gpointer data)
{
    MenuSlot *slot = data;
    if (slot->menu)
        g_object_remove_weak_pointer(G_OBJECT(slot->menu), (gpointer *)&slot->menu);
    g_free(slot);
}

static gboolean popup_window_menu(GtkWidget *w, GdkEventButton *ev, gpointer data)
{
    MenuSlot *slot = g_object_get_data(G_OBJECT(w), "mr-menu-slot");
    if (!slot || !slot->menu || ev->button != 3)
        return FALSE;
    gtk_menu_popup(GTK_MENU(slot->menu), NULL, NULL, NULL, NULL, ev->button, ev->time);
    return TRUE;
}

static JSValue h_window_set_menu(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    GtkWidget *menu = NULL;
    if (argc >= 1 && !JS_IsNull(argv[0]) && !JS_IsUndefined(argv[0])) {
        if (!(menu = arg_widget(ctx, argc, argv, 0, "window.setMenu")))
            return JS_EXCEPTION;
        if (!GTK_IS_MENU(menu))
            return JS_ThrowTypeError(ctx, "window.setMenu: expected a GtkMenu, got a %s", G_OBJECT_TYPE_NAME(menu));
    }
#ifdef MR_HILDON
    if (HILDON_IS_WINDOW(o)) {
        hildon_window_set_menu(HILDON_WINDOW(o), menu ? GTK_MENU(menu) : NULL);
        return JS_UNDEFINED;
    }
#endif
    {
        MenuSlot *slot = g_object_get_data(o, "mr-menu-slot");
        if (!slot) {
            slot = g_new0(MenuSlot, 1);
            g_object_set_data_full(o, "mr-menu-slot", slot, menu_slot_free);
            gtk_widget_add_events(GTK_WIDGET(o), GDK_BUTTON_PRESS_MASK);
            g_signal_connect(o, "button-press-event", G_CALLBACK(popup_window_menu), NULL);
        }
        if (slot->menu)
            g_object_remove_weak_pointer(G_OBJECT(slot->menu), (gpointer *)&slot->menu);
        slot->menu = menu;
        if (menu)
            g_object_add_weak_pointer(G_OBJECT(menu), (gpointer *)&slot->menu);
    }
    return JS_UNDEFINED;
}

static JSValue h_window_banner(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    const char *text;
    if (argc < 1 || !JS_IsString(argv[0]))
        return JS_ThrowTypeError(ctx, "window.banner: give the text");
    text = JS_ToCString(ctx, argv[0]);
#ifdef MR_HILDON
    hildon_banner_show_information(GTK_WIDGET(o), NULL, text);
#else
    fprintf(stderr, "banner: %s\n", text);
#endif
    JS_FreeCString(ctx, text);
    return JS_UNDEFINED;
}

static JSValue h_object_emit(JSContext *ctx, GObject *o, int argc, JSValueConst *argv)
{
    const char *name;
    guint id, i;
    GQuark detail;
    GSignalQuery q;
    GValue *params;
    GValue ret = { 0 };
    GType rtype;
    JSValue result = JS_UNDEFINED;
    int bad = 0;
    if (argc < 1 || !(name = JS_ToCString(ctx, argv[0])))
        return JS_ThrowTypeError(ctx, "object.emit: give the signal name");
    if (!g_signal_parse_name(name, G_OBJECT_TYPE(o), &id, &detail, TRUE)) {
        JS_ThrowTypeError(ctx, "%s has no signal '%s'", G_OBJECT_TYPE_NAME(o), name);
        JS_FreeCString(ctx, name);
        return JS_EXCEPTION;
    }
    JS_FreeCString(ctx, name);
    g_signal_query(id, &q);
    if ((guint)(argc - 1) != q.n_params)
        return JS_ThrowTypeError(ctx, "signal '%s' takes %u arguments", q.signal_name, q.n_params);
    params = g_new0(GValue, q.n_params + 1);
    g_value_init(&params[0], G_OBJECT_TYPE(o));
    g_value_set_object(&params[0], o);
    for (i = 0; i < q.n_params && !bad; i++) {
        g_value_init(&params[i + 1], q.param_types[i] & ~G_SIGNAL_TYPE_STATIC_SCOPE);
        bad = mr_js_to_gvalue(ctx, argv[i + 1], &params[i + 1], NULL, q.signal_name) < 0;
    }
    if (!bad) {
        rtype = q.return_type & ~G_SIGNAL_TYPE_STATIC_SCOPE;
        if (rtype != G_TYPE_NONE)
            g_value_init(&ret, rtype);
        g_signal_emitv(params, id, detail, rtype != G_TYPE_NONE ? &ret : NULL);
        if (rtype != G_TYPE_NONE) {
            result = mr_gvalue_to_js(ctx, &ret, 0);
            g_value_unset(&ret);
        }
    }
    for (i = 0; i <= q.n_params; i++)
        if (G_IS_VALUE(&params[i]))
            g_value_unset(&params[i]);
    g_free(params);
    return bad ? JS_EXCEPTION : result;
}

/* GLib 2.12 has no g_object_get_type(). */
static GType object_type(void)
{
    return G_TYPE_OBJECT;
}

static const struct {
    const char *name;
    GType (*type)(void);
    HelperFn fn;
    gboolean emits; /* runs JavaScript: not counted as GTK time */
} helpers[] = {
    { "container.add", gtk_container_get_type, h_container_add, FALSE },
    { "container.indexOf", gtk_container_get_type, h_container_index_of, FALSE },
    { "box.reorder", gtk_box_get_type, h_box_reorder, FALSE },
    { "scrolled.add", gtk_scrolled_window_get_type, h_scrolled_add, FALSE },
    { "widget.removeFromParent", gtk_widget_get_type, h_remove_from_parent, FALSE },
    { "widget.show", gtk_widget_get_type, h_show, FALSE },
    { "widget.hide", gtk_widget_get_type, h_hide, FALSE },
    { "button.clicked", gtk_button_get_type, h_button_clicked, TRUE },
    { "window.registerProgram", gtk_window_get_type, h_register_program, FALSE },
    { "listStore.setColumnTypes", gtk_list_store_get_type, h_list_store_set_column_types, FALSE },
    { "listStore.insert", gtk_list_store_get_type, h_list_store_insert, FALSE },
    { "listStore.set", gtk_list_store_get_type, h_list_store_set, FALSE },
    { "listStore.get", gtk_list_store_get_type, h_list_store_get, FALSE },
    { "listStore.remove", gtk_list_store_get_type, h_list_store_remove, TRUE },
    { "listStore.move", gtk_list_store_get_type, h_list_store_move, FALSE },
    { "listStore.clear", gtk_list_store_get_type, h_list_store_clear, TRUE },
    { "listStore.length", gtk_list_store_get_type, h_list_store_length, FALSE },
    { "treeView.appendColumn", gtk_tree_view_get_type, h_tree_view_append_column, FALSE },
    { "treeView.selection", gtk_tree_view_get_type, h_tree_view_selection, FALSE },
    { "treeView.selectedIndex", gtk_tree_view_get_type, h_tree_view_selected_index, FALSE },
    { "treeView.selectIndex", gtk_tree_view_get_type, h_tree_view_select_index, TRUE },
    { "treeView.renderer", gtk_tree_view_get_type, h_tree_view_renderer, FALSE },
    { "column.pack", gtk_tree_view_column_get_type, h_column_pack, FALSE },
    { "column.addAttribute", gtk_tree_view_column_get_type, h_column_add_attribute, FALSE },
    { "range.setRange", gtk_range_get_type, h_range_set_range, TRUE },
    { "range.setIncrements", gtk_range_get_type, h_range_set_increments, FALSE },
    { "range.setValue", gtk_range_get_type, h_range_set_value, TRUE },
    { "range.getValue", gtk_range_get_type, h_range_get_value, FALSE },
    { "comboBox.setItems", gtk_combo_box_get_type, h_combo_set_items, TRUE },
    { "comboBox.activeText", gtk_combo_box_get_type, h_combo_active_text, FALSE },
    { "menu.reorder", gtk_menu_get_type, h_menu_reorder, FALSE },
    { "window.setMenu", gtk_window_get_type, h_window_set_menu, FALSE },
    { "window.banner", gtk_window_get_type, h_window_banner, FALSE },
    { "object.emit", object_type, h_object_emit, TRUE },
};

JSValue mr_call_helper(JSContext *ctx, GObject *o, const char *name, int argc, JSValueConst *argv)
{
    guint i;
    double t0;
    JSValue r;
    for (i = 0; i < G_N_ELEMENTS(helpers); i++) {
        if (strcmp(helpers[i].name, name))
            continue;
        if (!g_type_is_a(G_OBJECT_TYPE(o), helpers[i].type()))
            return JS_ThrowTypeError(ctx, "helper '%s' needs a %s, got a %s", name,
                                     g_type_name(helpers[i].type()), G_OBJECT_TYPE_NAME(o));
        t0 = mr_now_ms();
        r = helpers[i].fn(ctx, o, argc, argv);
        if (!helpers[i].emits)
            mr_bridge_ms += mr_now_ms() - t0;
        return r;
    }
    return JS_ThrowTypeError(ctx, "maemo:gobject has no helper '%s'", name);
}
