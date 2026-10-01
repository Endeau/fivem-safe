# Lua 5.4 + busted, to run safe_events tests without installing anything on the host.
FROM alpine:3.20
RUN apk add --no-cache lua5.4 lua5.4-dev luarocks5.4 build-base \
 && luarocks-5.4 install busted \
 && ln -sf /usr/bin/lua5.4 /usr/local/bin/lua
WORKDIR /work/safe_events
ENTRYPOINT ["busted"]
