# Deployment Guide

Step-by-step deployment of the Commons Hub Nostr relay on `relay.commonshub.brussels`.

## Prerequisites

- A server with Docker and Docker Compose installed
- DNS: `relay.commonshub.brussels` pointing to your server's IP
- SSL certificate (via Coolify, certbot, or similar)

## Option A: Deploy with Coolify

Coolify handles SSL, reverse proxying, and Docker orchestration.

### 1. Create the resource

1. In Coolify (`coolify.commonshub.brussels`), create a new **Docker Compose** resource
2. Set the Git repository to `https://github.com/CommonsHub/relay`
3. Branch: `main`

### 2. Set environment variables

In the Coolify resource settings, add:

```
RELAY_ADMIN_SECRET=<generate with: openssl rand -hex 32>
ADMIN_ALLOWED_IPS=<CommonsHub API server IP>
```

### 3. Configure domains

- `strfry` service → `relay.commonshub.brussels` (websocket, port 7777)
- `admin` service → internal only (port 3000), or expose under `/admin/` path

Coolify's Traefik proxy handles SSL automatically.

### 4. Deploy

Click deploy. Coolify builds both images and starts the containers.

### 5. Verify

```bash
# Check health
curl https://relay.commonshub.brussels/health

# Check NIP-11 info (strfry serves this over HTTP)
curl -H "Accept: application/nostr+json" https://relay.commonshub.brussels/

# Test websocket
websocat wss://relay.commonshub.brussels
```

## Option B: Deploy with Docker Compose (manual)

### 1. Clone and configure

```bash
ssh your-server
git clone https://github.com/CommonsHub/relay.git
cd relay
cp .env.example .env
nano .env  # Set RELAY_ADMIN_SECRET and ADMIN_ALLOWED_IPS
```

### 2. Build and start

```bash
docker compose up -d --build
```

### 3. Set up nginx

```bash
sudo cp nginx/relay.conf /etc/nginx/sites-available/relay.commonshub.brussels
sudo ln -s /etc/nginx/sites-available/relay.commonshub.brussels /etc/nginx/sites-enabled/
# Edit the file to set your API server IP in the allow directive
sudo nano /etc/nginx/sites-available/relay.commonshub.brussels
sudo nginx -t
sudo systemctl reload nginx
```

### 4. SSL with certbot

```bash
sudo certbot --nginx -d relay.commonshub.brussels
```

### 5. Verify

```bash
curl https://relay.commonshub.brussels/health
curl -H "Accept: application/nostr+json" https://relay.commonshub.brussels/
```

## Managing the Allowlist

### Add a pubkey (hex format)

```bash
curl -X POST https://relay.commonshub.brussels/admin/allow \
  -H "Authorization: Bearer $RELAY_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"pubkey": "ab3f..."}'
```

### Add an IP

```bash
curl -X POST https://relay.commonshub.brussels/admin/allow \
  -H "Authorization: Bearer $RELAY_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"ip": "91.99.139.62"}'
```

### List current allowlist

```bash
curl https://relay.commonshub.brussels/admin/allow \
  -H "Authorization: Bearer $RELAY_ADMIN_SECRET"
```

### Full sync from CommonsHub API

The CommonsHub API calls `POST /admin/allow/sync` periodically to reconcile the allowlist. See [CommonsHub API Nostr docs](https://github.com/CommonsHub/api/blob/main/docs/nostr.md) for details.

## Monitoring

strfry exposes Prometheus metrics. You can scrape them for monitoring relay activity.

## Backups

The relay data lives in the `relay-data` Docker volume. Back up `/data/strfry-db/` for the LMDB database and `/data/allowlist.json` for the allowlist.

```bash
# Backup
docker compose exec strfry /app/strfry export > backup.jsonl

# Restore
cat backup.jsonl | docker compose exec -T strfry /app/strfry import
```
