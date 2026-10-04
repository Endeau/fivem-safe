# fxaudit as an image: docker run --rm -v "$PWD:/src" <image> /src
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY vendor ./vendor
RUN npm run build

FROM node:22-alpine
LABEL org.opencontainers.image.title="fxaudit" \
      org.opencontainers.image.description="Finds FiveM server events that trust what the client sends." \
      org.opencontainers.image.source="https://github.com/Endeau/fivem-safe" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY package.json LICENSE ./
COPY bin ./bin
COPY --from=build /app/dist ./dist
RUN ln -s /app/bin/fxaudit.js /usr/local/bin/fxaudit && chmod +x /app/bin/fxaudit.js
USER node
WORKDIR /src
ENTRYPOINT ["fxaudit"]
