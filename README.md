# Commons Hub Nostr Relay

A [strfry](https://github.com/hoytech/strfry)-based Nostr relay for the Commons Hub community.

- **Reads**: Open to everyone — anyone can subscribe to community events
- **Writes**: Restricted to whitelisted pubkeys and/or IP addresses
- **Admin API**: Manage the allowlist programmatically (IP-restricted)

Live at: `wss://relay.commonshub.brussels`

## Architecture

```
                    ┌─────────────────────────┐
                    │         nginx            │
                    │   relay.commonshub.brussels
                    │  :443 (SSL termination)  │
                    └────┬───────────┬─────────┘
                         │           │
              websocket  │           │  HTTP /admin/*
                         ▼           ▼
                    ┌──────────┐ ┌──────────┐
                    │  strfry  │ │  admin    │
                    │  :7777   │ │  :3000    │
                    └────┬─────┘ └────┬──────┘
                         │            │
                    write-policy      │
                    plugin ───────────┘
                         │            │
                         ▼            ▼
                    ┌─────────────────────┐
                    │  /data/allowlist.json│
                    │  (shared volume)     │
                    └─────────────────────┘
```

**strfry** handles all Nostr protocol (REQ/SUB/EVENT). On each incoming EVENT, it pipes the event through a **write-policy plugin** that checks pubkey and source IP against `allowlist.json`.

The **admin server** (Bun) exposes an HTTP API to manage `allowlist.json`, called by the [CommonsHub API](https://github.com/CommonsHub/api) during user lifecycle events.

## Quick Start

```bash
# Clone
git clone https://github.com/CommonsHub/relay.git
cd relay

# Configure
cp .env.example .env
# Edit .env with your RELAY_ADMIN_SECRET

# Run
docker compose up -d
```

The relay listens on port 7777 (websocket) and the admin API on port 3000.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RELAY_ADMIN_SECRET` | Bearer token for admin API | (required) |
| `ADMIN_ALLOWED_IPS` | Comma-separated IPs allowed to call admin API | `127.0.0.1` |
| `STRFRY_DATA_DIR` | Path to strfry data directory | `/data` |

## Admin API

All admin endpoints require:
- `Authorization: Bearer <RELAY_ADMIN_SECRET>`
- Request must come from an allowed IP

### `POST /admin/allow`

Add a pubkey (hex) and/or IP to the allowlist.

```json
{ "pubkey": "ab3f..." }
```

```json
{ "ip": "91.99.139.62" }
```

Response: `201 Created` or `200 OK` (already exists)

### `DELETE /admin/allow`

Remove a pubkey or IP from the allowlist.

```json
{ "pubkey": "ab3f..." }
```

Response: `200 OK` or `404 Not Found`

### `GET /admin/allow`

List all allowed pubkeys and IPs.

Response:
```json
{
  "pubkeys": ["ab3f...", "cd5e..."],
  "ips": ["91.99.139.62"],
  "count": { "pubkeys": 2, "ips": 1 }
}
```

### `POST /admin/allow/sync`

Full reconciliation — replace entire allowlist.

```json
{
  "pubkeys": ["ab3f...", "cd5e...", "ef78..."],
  "ips": ["91.99.139.62"]
}
```

Response:
```json
{
  "added": 2,
  "removed": 1,
  "total": { "pubkeys": 3, "ips": 1 }
}
```

### `GET /health`

Health check (no auth required).

## Deployment on Coolify

1. Create a new Docker Compose resource in Coolify
2. Point it to this repo (`CommonsHub/relay`)
3. Set environment variables (`RELAY_ADMIN_SECRET`, `ADMIN_ALLOWED_IPS`)
4. Configure the domain `relay.commonshub.brussels` to proxy:
   - WebSocket traffic → strfry container port 7777
   - HTTP `/admin/*` → admin container port 3000
5. Deploy

See [docs/deployment.md](docs/deployment.md) for step-by-step instructions.

## Write Policy

The strfry write-policy plugin (`plugins/write-policy.js`) checks every incoming EVENT:

1. **Pubkey check**: Is `event.pubkey` in the allowlist?
2. **IP check**: Is the source IP in the allowlist?
3. If either matches → `accept`
4. If neither matches → `reject` with "blocked: not on allowlist"

This means the CommonsHub API server IP can always write (add it to `ADMIN_ALLOWED_IPS` and the IP allowlist), and individual users' pubkeys are managed via the admin API.

## Development

```bash
# Run locally
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Test the write policy plugin
echo '{"type":"new","event":{"id":"test","pubkey":"ab3f..."},"sourceType":"IP4","sourceInfo":"127.0.0.1"}' | node plugins/write-policy.js

# Test admin API
curl -H "Authorization: Bearer $RELAY_ADMIN_SECRET" http://localhost:3000/admin/allow
```

## License

MIT
