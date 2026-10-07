/* Conversion between JavaScript values and GValues. The rules are strict:
   a boolean property takes only a boolean, a number property only a number. */
#include <math.h>
#include <string.h>
#include <gtk/gtk.h>
#include "mr.h"

/* The allowed range for a number type; from the GParamSpec if there is one. */
static void number_range(GParamSpec *ps, GType ft, double *lo, double *hi)
{
    switch (ft) {
    case G_TYPE_CHAR:
        *lo = ps && G_IS_PARAM_SPEC_CHAR(ps) ? G_PARAM_SPEC_CHAR(ps)->minimum : -128;
        *hi = ps && G_IS_PARAM_SPEC_CHAR(ps) ? G_PARAM_SPEC_CHAR(ps)->maximum : 127;
        break;
    case G_TYPE_UCHAR:
        *lo = ps && G_IS_PARAM_SPEC_UCHAR(ps) ? G_PARAM_SPEC_UCHAR(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_UCHAR(ps) ? G_PARAM_SPEC_UCHAR(ps)->maximum : 255;
        break;
    case G_TYPE_INT:
        *lo = ps && G_IS_PARAM_SPEC_INT(ps) ? G_PARAM_SPEC_INT(ps)->minimum : G_MININT;
        *hi = ps && G_IS_PARAM_SPEC_INT(ps) ? G_PARAM_SPEC_INT(ps)->maximum : G_MAXINT;
        break;
    case G_TYPE_UINT:
        *lo = ps && G_IS_PARAM_SPEC_UINT(ps) ? G_PARAM_SPEC_UINT(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_UINT(ps) ? G_PARAM_SPEC_UINT(ps)->maximum : G_MAXUINT;
        break;
    case G_TYPE_LONG:
        *lo = ps && G_IS_PARAM_SPEC_LONG(ps) ? G_PARAM_SPEC_LONG(ps)->minimum : G_MINLONG;
        *hi = ps && G_IS_PARAM_SPEC_LONG(ps) ? G_PARAM_SPEC_LONG(ps)->maximum : G_MAXLONG;
        break;
    case G_TYPE_ULONG:
        *lo = ps && G_IS_PARAM_SPEC_ULONG(ps) ? G_PARAM_SPEC_ULONG(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_ULONG(ps) ? G_PARAM_SPEC_ULONG(ps)->maximum : G_MAXULONG;
        break;
    case G_TYPE_INT64:
        *lo = ps && G_IS_PARAM_SPEC_INT64(ps) ? MAX((double)G_PARAM_SPEC_INT64(ps)->minimum, -9007199254740991.0) : -9007199254740991.0;
        *hi = ps && G_IS_PARAM_SPEC_INT64(ps) ? MIN((double)G_PARAM_SPEC_INT64(ps)->maximum, 9007199254740991.0) : 9007199254740991.0;
        break;
    case G_TYPE_UINT64:
        *lo = ps && G_IS_PARAM_SPEC_UINT64(ps) ? (double)G_PARAM_SPEC_UINT64(ps)->minimum : 0;
        *hi = ps && G_IS_PARAM_SPEC_UINT64(ps) ? MIN((double)G_PARAM_SPEC_UINT64(ps)->maximum, 9007199254740991.0) : 9007199254740991.0;
        break;
    case G_TYPE_FLOAT:
        *lo = ps && G_IS_PARAM_SPEC_FLOAT(ps) ? G_PARAM_SPEC_FLOAT(ps)->minimum : -G_MAXFLOAT;
        *hi = ps && G_IS_PARAM_SPEC_FLOAT(ps) ? G_PARAM_SPEC_FLOAT(ps)->maximum : G_MAXFLOAT;
        break;
    default: /* G_TYPE_DOUBLE */
        *lo = ps && G_IS_PARAM_SPEC_DOUBLE(ps) ? G_PARAM_SPEC_DOUBLE(ps)->minimum : -G_MAXDOUBLE;
        *hi = ps && G_IS_PARAM_SPEC_DOUBLE(ps) ? G_PARAM_SPEC_DOUBLE(ps)->maximum : G_MAXDOUBLE;
        break;
    }
}

/* The fundamental type that decides the conversion. An interface with GObject
   as a prerequisite, for example GtkTreeModel, holds an object. */
static GType convert_kind(GType t)
{
    if (G_TYPE_IS_INTERFACE(t) && g_type_is_a(t, G_TYPE_OBJECT))
        return G_TYPE_OBJECT;
    return G_TYPE_FUNDAMENTAL(t);
}

static int to_number(JSContext *ctx, JSValueConst v, GValue *out, GParamSpec *ps, const char *what)
{
    GType ft = G_TYPE_FUNDAMENTAL(G_VALUE_TYPE(out));
    double d, lo, hi;
    if (!JS_IsNumber(v)) {
        JS_ThrowTypeError(ctx, "%s: expected a number", what);
        return -1;
    }
    JS_ToFloat64(ctx, &d, v);
    if (ft != G_TYPE_FLOAT && ft != G_TYPE_DOUBLE && (!isfinite(d) || d != floor(d))) {
        JS_ThrowRangeError(ctx, "%s: expected an integer, got %g", what, d);
        return -1;
    }
    number_range(ps, ft, &lo, &hi);
    if (!(d >= lo && d <= hi)) {
        JS_ThrowRangeError(ctx, "%s: %g is out of the range %g to %g", what, d, lo, hi);
        return -1;
    }
    switch (ft) {
    case G_TYPE_CHAR: g_value_set_char(out, (gchar)d); break;
    case G_TYPE_UCHAR: g_value_set_uchar(out, (guchar)d); break;
    case G_TYPE_INT: g_value_set_int(out, (gint)d); break;
    case G_TYPE_UINT: g_value_set_uint(out, (guint)d); break;
    case G_TYPE_LONG: g_value_set_long(out, (glong)d); break;
    case G_TYPE_ULONG: g_value_set_ulong(out, (gulong)d); break;
    case G_TYPE_INT64: g_value_set_int64(out, (gint64)d); break;
    case G_TYPE_UINT64: g_value_set_uint64(out, (guint64)d); break;
    case G_TYPE_FLOAT: g_value_set_float(out, (gfloat)d); break;
    default: g_value_set_double(out, d); break;
    }
    return 0;
}

static int to_enum(JSContext *ctx, JSValueConst v, GValue *out, const char *what)
{
    GEnumClass *ec = g_type_class_ref(G_VALUE_TYPE(out));
    GEnumValue *ev = NULL;
    if (JS_IsString(v)) {
        const char *s = JS_ToCString(ctx, v);
        ev = g_enum_get_value_by_nick(ec, s);
        if (!ev)
            ev = g_enum_get_value_by_name(ec, s);
        JS_FreeCString(ctx, s);
    } else if (JS_IsNumber(v)) {
        int32_t n;
        JS_ToInt32(ctx, &n, v);
        ev = g_enum_get_value(ec, n);
    }
    if (!ev) {
        GString *nicks = g_string_new(NULL);
        guint i;
        for (i = 0; i < ec->n_values; i++)
            g_string_append_printf(nicks, "%s%s", i ? ", " : "", ec->values[i].value_nick);
        JS_ThrowTypeError(ctx, "%s: not a %s value; expected one of: %s", what,
                          G_VALUE_TYPE_NAME(out), nicks->str);
        g_string_free(nicks, TRUE);
        g_type_class_unref(ec);
        return -1;
    }
    g_value_set_enum(out, ev->value);
    g_type_class_unref(ec);
    return 0;
}

static int to_flags(JSContext *ctx, JSValueConst v, GValue *out, const char *what)
{
    GFlagsClass *fc = g_type_class_ref(G_VALUE_TYPE(out));
    guint bits = 0;
    int ok = 0;
    if (JS_IsNumber(v)) {
        uint32_t n;
        JS_ToUint32(ctx, &n, v);
        bits = n;
    } else if (JS_IsArray(ctx, v)) {
        JSValue lenv = JS_GetPropertyStr(ctx, v, "length");
        uint32_t i, len = 0;
        JS_ToUint32(ctx, &len, lenv);
        JS_FreeValue(ctx, lenv);
        for (i = 0; i < len && ok == 0; i++) {
            JSValue item = JS_GetPropertyUint32(ctx, v, i);
            const char *s = JS_IsString(item) ? JS_ToCString(ctx, item) : NULL;
            GFlagsValue *fv = s ? g_flags_get_value_by_nick(fc, s) : NULL;
            if (s && !fv)
                fv = g_flags_get_value_by_name(fc, s);
            if (fv)
                bits |= fv->value;
            else {
                JS_ThrowTypeError(ctx, "%s: '%s' is not a %s flag", what, s ? s : "?", G_VALUE_TYPE_NAME(out));
                ok = -1;
            }
            if (s)
                JS_FreeCString(ctx, s);
            JS_FreeValue(ctx, item);
        }
    } else {
        JS_ThrowTypeError(ctx, "%s: expected an array of flag names", what);
        ok = -1;
    }
    if (ok == 0)
        g_value_set_flags(out, bits);
    g_type_class_unref(fc);
    return ok;
}

int mr_js_to_gvalue(JSContext *ctx, JSValueConst v, GValue *out, GParamSpec *ps, const char *what)
{
    switch (convert_kind(G_VALUE_TYPE(out))) {
    case G_TYPE_BOOLEAN:
        if (!JS_IsBool(v)) {
            JS_ThrowTypeError(ctx, "%s: expected a boolean", what);
            return -1;
        }
        g_value_set_boolean(out, JS_ToBool(ctx, v));
        return 0;
    case G_TYPE_CHAR: case G_TYPE_UCHAR: case G_TYPE_INT: case G_TYPE_UINT:
    case G_TYPE_LONG: case G_TYPE_ULONG: case G_TYPE_INT64: case G_TYPE_UINT64:
    case G_TYPE_FLOAT: case G_TYPE_DOUBLE:
        return to_number(ctx, v, out, ps, what);
    case G_TYPE_STRING:
        if (JS_IsNull(v) || JS_IsUndefined(v)) {
            g_value_set_string(out, NULL);
        } else if (JS_IsString(v)) {
            const char *s = JS_ToCString(ctx, v);
            g_value_set_string(out, s);
            JS_FreeCString(ctx, s);
        } else {
            JS_ThrowTypeError(ctx, "%s: expected a string", what);
            return -1;
        }
        return 0;
    case G_TYPE_ENUM:
        return to_enum(ctx, v, out, what);
    case G_TYPE_FLAGS:
        return to_flags(ctx, v, out, what);
    case G_TYPE_OBJECT: {
        GObject *obj;
        if (JS_IsNull(v) || JS_IsUndefined(v)) {
            g_value_set_object(out, NULL);
            return 0;
        }
        if (!(obj = mr_arg_object(ctx, v)))
            return -1;
        if (!g_type_is_a(G_OBJECT_TYPE(obj), G_VALUE_TYPE(out))) {
            JS_ThrowTypeError(ctx, "%s: expected a %s, got a %s", what,
                              G_VALUE_TYPE_NAME(out), G_OBJECT_TYPE_NAME(obj));
            return -1;
        }
        g_value_set_object(out, obj);
        return 0;
    }
    case G_TYPE_BOXED:
        if (G_VALUE_TYPE(out) == GDK_TYPE_COLOR) {
            GdkColor color;
            const char *s;
            gboolean ok;
            if (JS_IsNull(v) || JS_IsUndefined(v)) {
                g_value_set_boxed(out, NULL);
                return 0;
            }
            if (!JS_IsString(v)) {
                JS_ThrowTypeError(ctx, "%s: expected a color string such as #rrggbb", what);
                return -1;
            }
            s = JS_ToCString(ctx, v);
            ok = gdk_color_parse(s, &color);
            if (!ok)
                JS_ThrowTypeError(ctx, "%s: '%s' is not a color; use #rrggbb", what, s);
            JS_FreeCString(ctx, s);
            if (!ok)
                return -1;
            g_value_set_boxed(out, &color);
            return 0;
        }
        break;
    default:
        break;
    }
    JS_ThrowTypeError(ctx, "%s: maemo:gobject cannot convert values of type %s",
                      what, G_VALUE_TYPE_NAME(out));
    return -1;
}

JSValue mr_gvalue_to_js(JSContext *ctx, const GValue *v, int strict)
{
    switch (convert_kind(G_VALUE_TYPE(v))) {
    case G_TYPE_BOOLEAN: return JS_NewBool(ctx, g_value_get_boolean(v));
    case G_TYPE_CHAR: return JS_NewInt32(ctx, g_value_get_char(v));
    case G_TYPE_UCHAR: return JS_NewInt32(ctx, g_value_get_uchar(v));
    case G_TYPE_INT: return JS_NewInt32(ctx, g_value_get_int(v));
    case G_TYPE_UINT: return JS_NewInt64(ctx, g_value_get_uint(v));
    case G_TYPE_LONG: return JS_NewInt64(ctx, g_value_get_long(v));
    case G_TYPE_ULONG: return JS_NewInt64(ctx, g_value_get_ulong(v));
    case G_TYPE_INT64: return JS_NewInt64(ctx, g_value_get_int64(v));
    case G_TYPE_UINT64: return JS_NewFloat64(ctx, (double)g_value_get_uint64(v));
    case G_TYPE_FLOAT: return JS_NewFloat64(ctx, g_value_get_float(v));
    case G_TYPE_DOUBLE: return JS_NewFloat64(ctx, g_value_get_double(v));
    case G_TYPE_STRING: {
        const char *s = g_value_get_string(v);
        return s ? JS_NewString(ctx, s) : JS_NULL;
    }
    case G_TYPE_ENUM: {
        GEnumClass *ec = g_type_class_ref(G_VALUE_TYPE(v));
        GEnumValue *ev = g_enum_get_value(ec, g_value_get_enum(v));
        JSValue r = ev ? JS_NewString(ctx, ev->value_nick) : JS_NewInt32(ctx, g_value_get_enum(v));
        g_type_class_unref(ec);
        return r;
    }
    case G_TYPE_FLAGS: {
        GFlagsClass *fc = g_type_class_ref(G_VALUE_TYPE(v));
        guint bits = g_value_get_flags(v), i;
        JSValue arr = JS_NewArray(ctx);
        uint32_t n = 0;
        for (i = 0; i < fc->n_values; i++) {
            guint fv = fc->values[i].value;
            if (fv && (bits & fv) == fv)
                JS_SetPropertyUint32(ctx, arr, n++, JS_NewString(ctx, fc->values[i].value_nick));
        }
        g_type_class_unref(fc);
        return arr;
    }
    case G_TYPE_OBJECT: {
        GObject *o = g_value_get_object(v);
        int32_t h = o ? mr_handle_of(o) : 0;
        return h ? JS_NewInt32(ctx, h) : JS_NULL;
    }
    case G_TYPE_BOXED:
        if (G_VALUE_TYPE(v) == GDK_TYPE_COLOR) {
            GdkColor *c = g_value_get_boxed(v);
            char buf[8];
            if (!c)
                return JS_NULL;
            g_snprintf(buf, sizeof buf, "#%02x%02x%02x", c->red >> 8, c->green >> 8, c->blue >> 8);
            return JS_NewString(ctx, buf);
        }
        break;
    default:
        break;
    }
    if (strict)
        return JS_ThrowTypeError(ctx, "maemo:gobject cannot convert values of type %s",
                                 G_VALUE_TYPE_NAME(v));
    return JS_UNDEFINED;
}
