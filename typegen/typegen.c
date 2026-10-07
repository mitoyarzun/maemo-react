/* typegen: write the properties, child properties and signals of GTK and
   Hildon classes as JSON, for the TypeScript types. typegen/run.sh runs it
   on the Diablo libraries under qemu-user, so the types match the tablet.

     typegen GtkLabel GtkButton ... > gtk.json

   Each class comes with its parents up to GtkWidget. A class lists only the
   properties and signals that it adds, and the signals of the interfaces
   that it adds. */
#include <stdio.h>
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"
#ifdef MR_HILDON
#include <hildon/hildon-window.h>
#endif

static void json_string(const char *s)
{
    putchar('"');
    for (; s && *s; s++) {
        if (*s == '"' || *s == '\\')
            printf("\\%c", *s);
        else if ((unsigned char)*s < 0x20)
            printf("\\u%04x", *s);
        else
            putchar(*s);
    }
    putchar('"');
}

static const char *kind_of(GType t)
{
    if (G_TYPE_IS_INTERFACE(t) && g_type_is_a(t, G_TYPE_OBJECT))
        return "object"; /* an interface with GObject as a prerequisite, for example GtkTreeModel */
    if (t == GDK_TYPE_COLOR)
        return "color";
    switch (G_TYPE_FUNDAMENTAL(t)) {
    case G_TYPE_BOOLEAN: return "boolean";
    case G_TYPE_CHAR: case G_TYPE_UCHAR: case G_TYPE_INT: case G_TYPE_UINT:
    case G_TYPE_LONG: case G_TYPE_ULONG: case G_TYPE_INT64: case G_TYPE_UINT64:
    case G_TYPE_FLOAT: case G_TYPE_DOUBLE: return "number";
    case G_TYPE_STRING: return "string";
    case G_TYPE_ENUM: return "enum";
    case G_TYPE_FLAGS: return "flags";
    case G_TYPE_OBJECT: return "object";
    default: return "other";
    }
}

static void type_json(GType t)
{
    guint i, n = 0;
    printf("{\"type\":");
    json_string(t == G_TYPE_NONE ? "void" : g_type_name(t));
    printf(",\"kind\":\"%s\"", kind_of(t));
    if (G_TYPE_FUNDAMENTAL(t) == G_TYPE_ENUM) {
        GEnumClass *ec = g_type_class_ref(t);
        printf(",\"values\":[");
        for (i = 0; i < ec->n_values; i++) {
            if (i)
                putchar(',');
            json_string(ec->values[i].value_nick);
        }
        putchar(']');
        g_type_class_unref(ec);
    } else if (G_TYPE_FUNDAMENTAL(t) == G_TYPE_FLAGS) {
        GFlagsClass *fc = g_type_class_ref(t);
        printf(",\"values\":[");
        for (i = 0; i < fc->n_values; i++) {
            if (!fc->values[i].value)
                continue;
            if (n++)
                putchar(',');
            json_string(fc->values[i].value_nick);
        }
        putchar(']');
        g_type_class_unref(fc);
    }
    putchar('}');
}

static void props_json(GParamSpec **ps, guint n, GType owner)
{
    guint i, k = 0;
    putchar('[');
    for (i = 0; i < n; i++) {
        if (ps[i]->owner_type != owner)
            continue;
        if (k++)
            putchar(',');
        printf("{\"name\":");
        json_string(ps[i]->name);
        printf(",\"value\":");
        type_json(G_PARAM_SPEC_VALUE_TYPE(ps[i]));
        printf(",\"readable\":%s,\"writable\":%s,\"constructOnly\":%s}",
               ps[i]->flags & G_PARAM_READABLE ? "true" : "false",
               ps[i]->flags & G_PARAM_WRITABLE ? "true" : "false",
               ps[i]->flags & G_PARAM_CONSTRUCT_ONLY ? "true" : "false");
    }
    putchar(']');
}

static int signals_of(GType t, int count)
{
    guint n, i, j;
    guint *ids = g_signal_list_ids(t, &n);
    for (i = 0; i < n; i++) {
        GSignalQuery q;
        g_signal_query(ids[i], &q);
        if (count++)
            putchar(',');
        printf("{\"name\":");
        json_string(q.signal_name);
        printf(",\"returns\":");
        type_json(q.return_type & ~G_SIGNAL_TYPE_STATIC_SCOPE);
        printf(",\"params\":[");
        for (j = 0; j < q.n_params; j++) {
            if (j)
                putchar(',');
            type_json(q.param_types[j] & ~G_SIGNAL_TYPE_STATIC_SCOPE);
        }
        printf("]}");
    }
    g_free(ids);
    return count;
}

static void signals_json(GType t)
{
    GType parent = g_type_parent(t);
    GType *ifaces;
    guint n, i;
    int count;
    putchar('[');
    count = signals_of(t, 0);
    ifaces = g_type_interfaces(t, &n);
    for (i = 0; i < n; i++)
        if (!g_type_is_a(parent, ifaces[i]))
            count = signals_of(ifaces[i], count);
    g_free(ifaces);
    putchar(']');
}

int main(int argc, char **argv)
{
    GPtrArray *order = g_ptr_array_new();
    GHashTable *seen = g_hash_table_new(g_direct_hash, g_direct_equal);
    guint k;
    int i;
    gtk_init_check(&argc, &argv); /* some class_init functions use GDK */
#ifdef MR_HILDON
    /* Use a Hildon symbol, so that the linker keeps libhildon and
       mr_type_from_name can find the Hildon get_type functions. */
    volatile GType keep = hildon_window_get_type(); /* G_GNUC_CONST: a plain call goes away at -O2 */
    (void)keep;
#endif
    for (i = 1; i < argc; i++) {
        GType t = mr_type_from_name(argv[i]);
        GPtrArray *chain = g_ptr_array_new();
        if (!t) {
            fprintf(stderr, "typegen: unknown type %s\n", argv[i]);
            return 1;
        }
        for (; t && t != GTK_TYPE_OBJECT; t = g_type_parent(t))
            g_ptr_array_add(chain, GSIZE_TO_POINTER(t));
        while (chain->len) {
            gpointer c = g_ptr_array_index(chain, chain->len - 1);
            g_ptr_array_remove_index(chain, chain->len - 1);
            if (!g_hash_table_lookup(seen, c)) {
                g_hash_table_insert(seen, c, c);
                g_ptr_array_add(order, c);
            }
        }
        g_ptr_array_free(chain, TRUE);
    }
    printf("{\"gtk\":\"%d.%d.%d\",\"classes\":[", gtk_major_version, gtk_minor_version, gtk_micro_version);
    for (k = 0; k < order->len; k++) {
        GType t = GPOINTER_TO_SIZE(g_ptr_array_index(order, k));
        GObjectClass *klass = g_type_class_ref(t);
        GParamSpec **ps;
        guint n;
        if (k)
            putchar(',');
        printf("\n{\"name\":");
        json_string(g_type_name(t));
        printf(",\"parent\":");
        if (t == GTK_TYPE_WIDGET)
            printf("null");
        else
            json_string(g_type_name(g_type_parent(t)));
        printf(",\"abstract\":%s,\"properties\":", G_TYPE_IS_ABSTRACT(t) ? "true" : "false");
        ps = g_object_class_list_properties(klass, &n);
        props_json(ps, n, t);
        g_free(ps);
        printf(",\"childProperties\":");
        if (g_type_is_a(t, GTK_TYPE_CONTAINER)) {
            ps = gtk_container_class_list_child_properties(klass, &n);
            props_json(ps, n, t);
            g_free(ps);
        } else {
            printf("[]");
        }
        printf(",\"signals\":");
        signals_json(t);
        putchar('}');
        g_type_class_unref(klass);
    }
    printf("\n]}\n");
    return 0;
}
