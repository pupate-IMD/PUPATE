# Deploying Pupate: one VPS for the site and the keeper

The site is a static export and the keeper is one Node process, so a small server carries both:
nginx serves `site/out/` at `https://pupate.fun` with a Let's Encrypt certificate, and the keeper runs
under pm2 as the `pupate` user and writes `status.json`, `listings.json` and `work.json` straight into
the web root. The feeds are live at `https://pupate.fun/status.json` without a second service, and an
agent reading `skill.md` finds everything on one origin. The export is plain files, so the site alone
can live on any static host; this is the arrangement where the feeds come for free.

## What you need

- A VPS running Ubuntu 22.04 or 24.04 with 2 GB of RAM (the Next.js build wants it; with 1 GB, build
  elsewhere, see below) and root over SSH.
- DNS: an `A` record for `pupate.fun` pointing at the server, and one for `www` unless you run with
  `WWW=0`. Set them before the TLS step, which proves the domain over HTTP.
- An RPC URL (Alchemy or similar), the keeper's key, and after the launch the contract addresses.
  Optional: a WalletConnect project id for the site, an OpenSea API key for the buy step.

## Setting up

    apt-get update && apt-get install -y git
    git clone https://github.com/pupate-IMD/PUPATE.git /opt/pupate/app
    DOMAIN=pupate.fun EMAIL=you@example.com bash /opt/pupate/app/deploy/setup.sh

`setup.sh` installs nginx, certbot, Node 22 and pm2; creates the `pupate` user; seeds the two env
files when they do not exist (`/etc/pupate/site.env` for the site's public variables,
`/opt/pupate/app/.env` for the keeper, mode 600); writes the nginx server block; runs `update.sh`
(build, publish, keeper); asks Let's Encrypt for the certificate; and registers pm2 with systemd so
the keeper comes back after a reboot. Running it again is safe: it adds what is missing and never
rewrites an env file or the server block certbot manages.

Variables: `DOMAIN` (`pupate.fun`), `EMAIL` (the Let's Encrypt account; leave it empty to stay on
plain HTTP for now and run the script again later), `WWW=0` to serve the apex only, `BRANCH` and
`REPO`, `UFW=1` to allow 22, 80 and 443 with ufw and enable it.

Then fill in the two files and run the update:

    nano /opt/pupate/app/.env      # RPC, KEEPER_PRIVATE_KEY, the addresses: keeper/README.md explains each line
    nano /etc/pupate/site.env      # NEXT_PUBLIC_*: site/README.md
    bash /opt/pupate/app/deploy/update.sh

The keeper starts on the first update that finds `RPC=` set. Without `KEEPER_PRIVATE_KEY` it only
simulates and still publishes the feeds, which is a fine way to watch a fresh server before trusting it
with a key.

## Updating

    bash /opt/pupate/app/deploy/update.sh

Pulls `main`, runs `npm ci` and `npm run build` in `site/`, rsyncs `out/` into the web root while
keeping the keeper's three JSON files, refreshes nginx's locations and restarts the keeper.

## Checking

    curl -I https://pupate.fun/
    curl -s https://pupate.fun/status.json | jq '.keeper.lastTickAt, .steps'
    curl -sI https://pupate.fun/skill.md | grep -i content-type        # text/markdown
    sudo -iu pupate pm2 status
    sudo -iu pupate pm2 logs pupate-keeper

## Building elsewhere

On a 1 GB server, or to publish a build without pulling, build on your own machine and copy the export:

    cd site && npm run build
    rsync -az --delete --exclude status.json --exclude listings.json --exclude work.json out/ root@SERVER:/var/www/pupate.fun/

## Files

| file | role |
|---|---|
| `setup.sh` | the one-shot install; safe to run again |
| `update.sh` | pull, build, publish, restart; `--no-pull` builds what is checked out |
| `nginx-site.conf` | the server block, written once; certbot adds TLS to it |
| `nginx-locations.conf` | the locations: pages revalidate on every visit, `_next/static` is immutable, the feeds are uncached and readable from any origin, `skill.md` is served as Markdown; rendered again on every update |
| `keeper.env.example` | the keeper's `.env` as `setup.sh` seeds it, with `STATUS_DIR` pointed at the web root |
