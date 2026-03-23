#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORBY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$ORBY_ROOT/.env" ]]; then
  echo "Error: missing $ORBY_ROOT/.env" >&2
  echo "Set DOMAIN and SSL_EMAIL in the project root .env first." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ORBY_ROOT/.env"
set +a

DOMAIN="${DOMAIN:-}"
SSL_EMAIL="${SSL_EMAIL:-}"

if [[ -z "$DOMAIN" || -z "$SSL_EMAIL" ]]; then
  echo "Error: DOMAIN and SSL_EMAIL must be set in $ORBY_ROOT/.env" >&2
  exit 1
fi

cd "$ORBY_ROOT"

docker compose up -d nginx

docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$SSL_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --keep-until-expiring

docker compose restart nginx
