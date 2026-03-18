# Multi-stage build for strfry + write-policy plugin

FROM alpine:3.18.3 AS build

WORKDIR /build

RUN apk --no-cache add \
    linux-headers git g++ make perl pkgconfig libtool \
    ca-certificates libressl-dev zlib-dev lmdb-dev \
    flatbuffers-dev libsecp256k1-dev zstd-dev \
  && rm -rf /var/cache/apk/*

RUN git clone https://github.com/hoytech/strfry.git . \
  && git submodule update --init \
  && make setup-golpe \
  && make clean \
  && make -j4

# --- Runtime ---
FROM alpine:3.18.3

WORKDIR /app

RUN apk --no-cache add \
    lmdb flatbuffers libsecp256k1 libb2 zstd libressl \
    nodejs \
  && rm -rf /var/cache/apk/*

COPY --from=build /build/strfry strfry
COPY strfry.conf /etc/strfry.conf
COPY plugins/ /app/plugins/

RUN chmod +x /app/plugins/write-policy.js \
  && mkdir -p /data/strfry-db

VOLUME /data

EXPOSE 7777

ENTRYPOINT ["/app/strfry"]
CMD ["--config=/etc/strfry.conf", "relay"]
