#!/bin/sh
# Démarrage dans Docker : crée le compte admin décrit dans .env (variables
# d'environnement passées par docker compose), puis lance PocketBase.
set -eu
cd /pb

if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  ./pocketbase migrate up --dir pb_data --migrationsDir pb_migrations --hooksDir pb_hooks > /dev/null
  ./pocketbase superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir pb_data
fi

set -- serve --dir pb_data --hooksDir pb_hooks --migrationsDir pb_migrations --publicDir pb_public \
  --indexFallback=false --http 0.0.0.0:8090
if [ -n "${PB_ORIGINS:-}" ]; then
  set -- "$@" --origins "$PB_ORIGINS"
fi
exec ./pocketbase "$@"
