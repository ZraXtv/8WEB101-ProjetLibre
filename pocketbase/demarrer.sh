#!/usr/bin/env bash
# Lance le quiz sur Linux ou macOS : télécharge PocketBase (version fixée dans
# VERSION, empreinte vérifiée) si besoin, crée le compte admin décrit dans
# .env, puis démarre le serveur. La base et les fichiers vont dans pb_data/.
#
#   ./demarrer.sh
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(tr -d '[:space:]' < VERSION)"

case "$(uname -s)" in
  Linux) systeme=linux ;;
  Darwin) systeme=darwin ;;
  *) echo "Système non pris en charge : $(uname -s). Sous Windows, lancer demarrer.ps1." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) archi=amd64 ;;
  aarch64 | arm64) archi=arm64 ;;
  *) echo "Processeur non pris en charge : $(uname -m)" >&2; exit 1 ;;
esac

installer_pocketbase() {
  local archive="pocketbase_${VERSION}_${systeme}_${archi}.zip"
  local url="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}"
  local temp
  temp="$(mktemp -d)"
  # Nettoyage au retour de cette fonction seulement (puis le piège est retiré).
  trap 'rm -rf "${temp:-}"; trap - RETURN' RETURN

  echo "Téléchargement de PocketBase ${VERSION} (${systeme}/${archi})..."
  curl -fsSL -o "$temp/$archive" "$url/$archive"
  curl -fsSL -o "$temp/checksums.txt" "$url/checksums.txt"

  local attendue obtenue
  attendue="$(grep " ${archive}\$" "$temp/checksums.txt" | cut -d' ' -f1)"
  if command -v sha256sum > /dev/null; then
    obtenue="$(sha256sum "$temp/$archive" | cut -d' ' -f1)"
  else
    obtenue="$(shasum -a 256 "$temp/$archive" | cut -d' ' -f1)"
  fi
  if [ -z "$attendue" ] || [ "$attendue" != "$obtenue" ]; then
    echo "Empreinte invalide pour $archive : téléchargement corrompu ou modifié." >&2
    exit 1
  fi

  if command -v unzip > /dev/null; then
    unzip -oq "$temp/$archive" pocketbase -d .
  else
    python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extract('pocketbase', '.')" "$temp/$archive"
  fi
  chmod +x pocketbase
}

if [ ! -x pocketbase ] || [ "$(./pocketbase --version 2>/dev/null | awk '{print $3}')" != "$VERSION" ]; then
  installer_pocketbase
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  # Applique d'abord les migrations : la base doit exister pour y créer le compte.
  ./pocketbase migrate up --dir pb_data --migrationsDir pb_migrations --hooksDir pb_hooks > /dev/null
  ./pocketbase superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir pb_data
fi

# --indexFallback=false : une adresse inconnue répond 404 au lieu de la page d'accueil.
options=(--dir pb_data --hooksDir pb_hooks --migrationsDir pb_migrations --publicDir pb_public
         --indexFallback=false --http "${PB_HTTP:-127.0.0.1:8090}")
if [ -n "${PB_ORIGINS:-}" ]; then
  options+=(--origins "$PB_ORIGINS")
fi

echo "Site : http://${PB_HTTP:-127.0.0.1:8090}   Tableau de bord : http://${PB_HTTP:-127.0.0.1:8090}/_/"
exec ./pocketbase serve "${options[@]}"
