#!/bin/sh

set -eu

if [ -z "${DOMAIN:-}" ]; then
  echo "DOMAIN is required" >&2
  exit 1
fi

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  envsubst '${DOMAIN}' < /etc/nginx/templates/https.conf.template > /etc/nginx/conf.d/default.conf
else
  envsubst '${DOMAIN}' < /etc/nginx/templates/http.conf.template > /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
