# Image du quiz : PocketBase (version de VERSION, empreinte vérifiée) avec les
# hooks, les migrations, le site et les questions de départ.
#   docker compose up --build
FROM alpine:3.20

ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates unzip wget

WORKDIR /pb
COPY VERSION ./
RUN set -eu; \
    version="$(tr -d '[:space:]' < VERSION)"; \
    archive="pocketbase_${version}_linux_${TARGETARCH}.zip"; \
    url="https://github.com/pocketbase/pocketbase/releases/download/v${version}"; \
    wget -q "$url/$archive" "$url/checksums.txt"; \
    grep " ${archive}\$" checksums.txt | sha256sum -c -; \
    unzip -q "$archive" pocketbase; \
    rm "$archive" checksums.txt

COPY pb_migrations ./pb_migrations
COPY pb_hooks ./pb_hooks
COPY pb_public ./pb_public
COPY donnees ./donnees
COPY docker-entrypoint.sh ./

# La base et les fichiers envoyés vivent hors de l'image : ils survivent à
# une reconstruction.
VOLUME /pb/pb_data
EXPOSE 8090
ENTRYPOINT ["/bin/sh", "/pb/docker-entrypoint.sh"]
