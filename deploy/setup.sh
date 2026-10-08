#!/usr/bin/env bash
# One-shot setup of a Pupate VPS (Ubuntu 22.04 or 24.04, as root): nginx and Let's Encrypt for the
# static site, Node 22 and pm2 for the keeper, whose feeds land straight in the web root.
#
#   apt-get install -y git && git clone https://github.com/pupate-IMD/PUPATE.git /opt/pupate/app
#   DOMAIN=pupate.fun EMAIL=you@example.com bash /opt/pupate/app/deploy/setup.sh
#
# Running it again is safe: it adds what is missing and never rewrites an env file or the server
# block certbot manages. deploy/README.md walks through it; deploy/update.sh is the day-to-day update.
set -euo pipefail

DOMAIN="${DOMAIN:-pupate.fun}"
EMAIL="${EMAIL:-}"                # the Let's Encrypt account; empty leaves the site on plain HTTP for now
WWW="${WWW:-1}"                   # also serve www.$DOMAIN (its DNS record must exist before the TLS step)
REPO="${REPO:-https://github.com/pupate-IMD/PUPATE.git}"
BRANCH="${BRANCH:-main}"
UFW="${UFW:-0}"                   # 1: allow 22, 80 and 443 with ufw and enable it
APP_USER=pupate
APP_HOME=/opt/pupate
APP_DIR="$APP_HOME/app"
WEB_ROOT="/var/www/$DOMAIN"
SITE_ENV=/etc/pupate/site.env
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "run this as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "packages"
apt-get update -q
apt-get install -y -q nginx certbot python3-certbot-nginx git rsync curl ca-certificates

say "node 22 and pm2"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2 --no-audit --no-fund
echo "node $(node -v), pm2 $(pm2 -v)"

say "the $APP_USER user and the checkout at $APP_DIR"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash "$APP_USER"
[ -d "$APP_DIR/.git" ] || git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_HOME"

say "environment files"
install -d -m 755 /etc/pupate
if [ ! -f "$SITE_ENV" ]; then
  cp "$APP_DIR/site/.env.example" "$SITE_ENV"
  echo "wrote $SITE_ENV: the site's public variables (site/README.md); edit it, then run deploy/update.sh"
fi
if [ ! -f "$APP_DIR/.env" ]; then
  sed "s#^STATUS_DIR=.*#STATUS_DIR=$WEB_ROOT#" "$HERE/keeper.env.example" > "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "wrote $APP_DIR/.env: the keeper's RPC, key and addresses go here (keeper/README.md explains each line)"
fi

say "web root and nginx"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$WEB_ROOT"
NAMES="$DOMAIN"; [ "$WWW" = 1 ] && NAMES="$DOMAIN www.$DOMAIN"
SITE_CONF="/etc/nginx/sites-available/$DOMAIN"
if [ ! -f "$SITE_CONF" ]; then
  sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__SERVER_NAMES__#$NAMES#g" -e "s#__WEB_ROOT__#$WEB_ROOT#g" "$HERE/nginx-site.conf" > "$SITE_CONF"
fi
ln -sf "$SITE_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
# update.sh renders the locations snippet the server block includes, tests the config and reloads nginx.

say "build, publish and the keeper (deploy/update.sh --no-pull)"
DOMAIN="$DOMAIN" APP_HOME="$APP_HOME" APP_DIR="$APP_DIR" WEB_ROOT="$WEB_ROOT" SITE_ENV="$SITE_ENV" bash "$HERE/update.sh" --no-pull

if [ "$UFW" = 1 ] && command -v ufw >/dev/null; then
  say "firewall"
  ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
fi

if [ -n "$EMAIL" ] && [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  say "certificate from Let's Encrypt"
  DOMS=(-d "$DOMAIN"); [ "$WWW" = 1 ] && DOMS+=(-d "www.$DOMAIN")
  certbot --nginx "${DOMS[@]}" --non-interactive --agree-tos -m "$EMAIL" --redirect
fi

say "pm2 at boot"
# Installs pm2-pupate.service, which brings back whatever `pm2 save` recorded for the user.
pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null

say "done"
echo "site:    http${EMAIL:+s}://$DOMAIN/   (web root $WEB_ROOT)"
echo "keeper:  sudo -iu $APP_USER pm2 status   |   sudo -iu $APP_USER pm2 logs pupate-keeper"
echo "next:    fill $APP_DIR/.env and $SITE_ENV, then: bash $APP_DIR/deploy/update.sh"
