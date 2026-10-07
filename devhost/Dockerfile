# The maemo-react dev image: the desktop toolchain (GTK 2.24, curl), the Diablo
# cross toolchain, qemu-user and qemu-system-arm, and a virtual X server.
# Ubuntu 24.04 is pinned: it still ships libgtk2.0-dev, and qemu 8.2 still
# has the n810 machine (removed in qemu 9.2).
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      build-essential pkg-config libgtk2.0-dev libcurl4-openssl-dev libssl-dev \
      gcc-arm-linux-gnueabi binutils-arm-linux-gnueabi \
      qemu-user qemu-system-arm mtd-utils socat \
      xvfb x11vnc xauth procps \
      dpkg-dev python3 openssl curl ca-certificates file perl \
    && rm -rf /var/lib/apt/lists/*

# Ubuntu's libcurl 8.5.0 has no WebSocket support. The host needs the same
# curl as the tablet: 8.22.0, with ws and wss. It goes to /usr/local, which
# pkg-config searches first. The file 00-usr-local.conf puts /usr/local/lib
# before the system libraries in the loader cache.
ARG CURL_VERSION=8.22.0
ARG CURL_SHA256=d54dd598bf05927a726deb38df31c6a255ba83ff1de57c5d1464dac3ed8f44a1
RUN cd /tmp \
    && curl -fsSL --retry 3 -O "https://curl.se/download/curl-$CURL_VERSION.tar.gz" \
    && echo "$CURL_SHA256  curl-$CURL_VERSION.tar.gz" | sha256sum -c - \
    && tar xzf "curl-$CURL_VERSION.tar.gz" && cd "curl-$CURL_VERSION" \
    && ./configure --prefix=/usr/local --with-openssl \
         --with-ca-bundle=/etc/ssl/certs/ca-certificates.crt \
         --enable-websockets \
         --disable-ldap --disable-ldaps --without-libpsl --without-libidn2 \
         --without-brotli --without-zstd --without-nghttp2 --without-libssh2 \
         --without-librtmp --disable-manual \
    && make -j"$(nproc)" >/dev/null && make install >/dev/null \
    && echo /usr/local/lib > /etc/ld.so.conf.d/00-usr-local.conf && ldconfig \
    && cd / && rm -rf "/tmp/curl-$CURL_VERSION" "/tmp/curl-$CURL_VERSION.tar.gz"
ENV PKG_CONFIG_PATH=/usr/local/lib/pkgconfig
