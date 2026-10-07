# maemo-react-host. Use build.sh, which sets the compiler for the target.
TARGET ?= desktop
BUILD  := build/$(TARGET)
CC     ?= cc
CFLAGS ?= -O2

QJS         := vendor/quickjs
QJS_VERSION := $(shell cat $(QJS)/VERSION)
QJS_OBJ     := $(addprefix $(BUILD)/qjs/,quickjs.o libregexp.o libunicode.o cutils.o dtoa.o)
SRC         := $(wildcard src/*.c)
OBJ         := $(patsubst src/%.c,$(BUILD)/obj/%.o,$(SRC))
HOST        := $(BUILD)/bin/maemo-react-host

PKGS := gtk+-2.0
ifeq ($(TARGET),diablo)
PKGS        += hildon-1
DEFS        := -DMR_HILDON
CURL_CFLAGS := -I/work/out/opt/n810-modern/include
CURL_LIBS   := -L/work/out/opt/n810-modern/lib -lcurl \
               -Wl,-rpath-link,/work/out/opt/n810-modern/lib \
               -Wl,-rpath-link,/work/sysroot-diablo/usr/lib
else
DEFS        :=
CURL_CFLAGS := $(shell pkg-config --cflags libcurl)
CURL_LIBS   := $(shell pkg-config --libs libcurl)
endif
GTK_CFLAGS := $(shell pkg-config --cflags $(PKGS))
GTK_LIBS   := $(shell pkg-config --libs $(PKGS))

QJS_CFLAGS  := $(CFLAGS) -std=gnu11 -fwrapv -funsigned-char -D_GNU_SOURCE \
               -DCONFIG_VERSION=\"$(QJS_VERSION)\" -w
HOST_CFLAGS := $(CFLAGS) -std=gnu99 -Wall -Wno-unused-parameter -Wno-deprecated-declarations -D_GNU_SOURCE \
               -I$(QJS) -Isrc $(GTK_CFLAGS) $(CURL_CFLAGS) $(DEFS) \
               -DMR_QJS_VERSION=\"$(QJS_VERSION)\"

PRELUDE := $(BUILD)/lib/maemo-react/prelude.js

all: $(HOST) $(PRELUDE)

$(PRELUDE): ../prelude/dist/prelude.js
	@mkdir -p $(@D)
	cp $< $@

../prelude/dist/prelude.js:
	@echo "no prelude/dist/prelude.js -- run 'npm run build:prelude' on the development computer"; exit 1

$(BUILD)/qjs/%.o: $(QJS)/%.c
	@mkdir -p $(@D)
	$(CC) $(QJS_CFLAGS) -c $< -o $@

$(BUILD)/obj/%.o: src/%.c src/mr.h
	@mkdir -p $(@D)
	$(CC) $(HOST_CFLAGS) -c $< -o $@

$(HOST): $(OBJ) $(QJS_OBJ)
	@mkdir -p $(@D)
	$(CC) $(LDFLAGS) -o $@ $^ $(GTK_LIBS) $(CURL_LIBS) -lm -ldl -lpthread -lrt
ifeq ($(TARGET),diablo)
	./check-glibc.sh $@
endif

TYPEGEN := $(BUILD)/bin/typegen

typegen: $(TYPEGEN)

$(TYPEGEN): ../typegen/typegen.c $(BUILD)/obj/gtype.o src/mr.h
	@mkdir -p $(@D)
	$(CC) $(HOST_CFLAGS) $(LDFLAGS) -o $@ ../typegen/typegen.c $(BUILD)/obj/gtype.o $(GTK_LIBS) -ldl

MR_VERSION := $(shell sed -n 's/^\#define MR_VERSION "\(.*\)"/\1/p' src/mr.h)
DEB_ROOT   := $(BUILD)/deb
RUNTIME_DEB := dist/maemo-react-runtime_$(MR_VERSION)_armel.deb

deb: $(HOST) $(PRELUDE)
ifneq ($(TARGET),diablo)
	@echo "the runtime package is for TARGET=diablo"; exit 1
endif
	rm -rf $(DEB_ROOT)
	mkdir -p $(DEB_ROOT)/DEBIAN $(DEB_ROOT)/opt/n810-modern/bin \
	         $(DEB_ROOT)/opt/n810-modern/lib/maemo-react $(DEB_ROOT)/opt/n810-modern/share/maemo-react/apps
	$(STRIP) -o $(DEB_ROOT)/opt/n810-modern/bin/maemo-react-host $(HOST)
	cp $(PRELUDE) $(DEB_ROOT)/opt/n810-modern/lib/maemo-react/
	sed 's/@VERSION@/$(MR_VERSION)/' pkg/control > $(DEB_ROOT)/DEBIAN/control
	install -m 755 pkg/postinst pkg/postrm $(DEB_ROOT)/DEBIAN/
	mkdir -p dist
	dpkg-deb -Zgzip --root-owner-group --build $(DEB_ROOT) $(RUNTIME_DEB)

clean:
	rm -rf build

.PHONY: all clean typegen deb
