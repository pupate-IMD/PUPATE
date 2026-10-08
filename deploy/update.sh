#!/usr/bin/env bash
# Update a Pupate VPS that deploy/setup.sh prepared: pull, build the site, publish it to the web root,
# refresh nginx's locations and start or restart the keeper.
#
#   bash /opt/pupate/app/deploy/update.sh             # as root (npm, git and pm2 run as the pupate user)
#   bash /opt/pupate/app/deploy/update.sh --no-pull   # build what is checked out (setup.sh calls this)
#
# Variables, all with the defaults setup.sh uses: DOMAIN (pupate.fun), APP_HOME (/opt/pupate),
# APP_DIR ($APP_HOME/app), WEB_ROOT (/var/www/$DOMAIN), SITE_ENV (/etc/pupate/site.env, the
# NEXT_PUBLIC_* variables baked into the export).
set -euo pipefail

DOMAIN="${DOMAIN:-pupate.fun}"
APP_USER="${APP_USER:-pupate}"
APP_HOME="${APP_HOME:-/opt/pupate}"
APP_DIR="${APP_DIR:-$APP_HOME/app}"
WEB_ROOT="${WEB_ROOT:-/var/www/$DOMAIN}"
SITE_ENV="${SITE_ENV:-/etc/pupate/site.env}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PULL=1
[ "${1:-}" = "--no-pull" ] && PULL=0

say() { printf '\n==> %s\n' "$*"; }
# Everything that touches the checkout, npm or pm2 runs as the app user, whoever started this script.
as_app() {
  if [ "$(id -un)" = "$APP_USER" ]; then bash -c "$1"; else runuser -u "$APP_USER" -- env HOME="$APP_HOME" bash -c "$1"; fi
}

if [ "$PULL" = 1 ]; then
  say "pulling $APP_DIR"
  as_app "git -C '$APP_DIR' pull --ff-only"
fi

say "building the site (variables from $SITE_ENV)"
[ -f "$SITE_ENV" ] || { echo "missing $SITE_ENV: deploy/setup.sh writes it from site/.env.example"; exit 1; }
as_app "set -a; . '$SITE_ENV'; set +a; cd '$APP_DIR/site' && npm ci --no-audit --no-fund && npm run build"

say "installing the keeper's dependencies"
as_app "cd '$APP_DIR/keeper' && npm ci --omit=dev --no-audit --no-fund"

say "publishing to $WEB_ROOT"
# The keeper rewrites these three in place; a new export must not delete them.
as_app "rsync -a --delete --exclude status.json --exclude listings.json --exclude work.json '$APP_DIR/site/out/' '$WEB_ROOT/'"

if [ "$(id -u)" = 0 ] && command -v nginx >/dev/null; then
  say "refreshing nginx's locations"
  sed "s#__WEB_ROOT__#$WEB_ROOT#g" "$HERE/nginx-locations.conf" > "/etc/nginx/snippets/pupate-$DOMAIN.conf"
  nginx -t && systemctl reload nginx
fi

# The keeper runs only once its .env names an RPC and the contracts; until then it has nothing to read.
if grep -qsE '^RPC=.+' "$APP_DIR/.env" && grep -qsE '^(COCOON|ADDRESSES)=.+' "$APP_DIR/.env"; then
  if as_app "pm2 describe pupate-keeper" >/dev/null 2>&1; then
    say "restarting the keeper"
    as_app "pm2 restart pupate-keeper --update-env"
  else
    say "starting the keeper"
    as_app "cd '$APP_DIR/keeper' && pm2 start bin/keeper.mjs --name pupate-keeper --exp-backoff-restart-delay=5000 -- --loop"
  fi
  as_app "pm2 save"
else
  say "keeper not started: $APP_DIR/.env has no RPC or no addresses yet; fill them in and run this script again"
fi

say "done: https://$DOMAIN/ (status feed at /status.json, keeper logs: pm2 logs pupate-keeper as $APP_USER)"
