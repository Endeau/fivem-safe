# FXServer (Linux artifacts) without txAdmin: the server starts straight on server.cfg.
FROM debian:bookworm-slim
ARG FX_BUILD_URL=https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/35245-6efb47dff473c0e2a12fb50b08d74c0eb24a50d5/fx.tar.xz
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && mkdir -p /opt/fx && curl -fsSL "$FX_BUILD_URL" | tar -xJ -C /opt/fx \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/data
EXPOSE 30120/tcp 30120/udp
ENTRYPOINT ["/opt/fx/run.sh", "+set", "serverProfile", "dev", "+exec", "server.cfg"]
