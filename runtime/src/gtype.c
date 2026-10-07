/* Find a GType by its name. A type exists only after its get_type function
   ran once, so for a name such as GtkVBox we call gtk_vbox_get_type. */
#include <dlfcn.h>
#include <glib-object.h>
#include "mr.h"

GType mr_type_from_name(const char *name)
{
    GType t = g_type_from_name(name);
    GType (*get_type)(void);
    GString *fn;
    const char *p;
    if (t)
        return t;
    fn = g_string_new(NULL);
    for (p = name; *p; p++) {
        if (p != name && g_ascii_isupper(*p) && g_ascii_islower(p[-1]))
            g_string_append_c(fn, '_');
        g_string_append_c(fn, g_ascii_tolower(*p));
    }
    g_string_append(fn, "_get_type");
    get_type = (GType (*)(void))dlsym(RTLD_DEFAULT, fn->str);
    g_string_free(fn, TRUE);
    return get_type ? get_type() : 0;
}
