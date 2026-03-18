/**
 * Admin API server for Commons Hub Nostr relay.
 *
 * Manages the allowlist file shared with strfry's write-policy plugin.
 * IP-restricted + Bearer token auth.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const PORT = parseInt(process.env.ADMIN_PORT || "3000", 10);
const ADMIN_SECRET = process.env.RELAY_ADMIN_SECRET;
const ALLOWED_IPS = (process.env.ADMIN_ALLOWED_IPS || "127.0.0.1")
  .split(",")
  .map((ip) => ip.trim());
const ALLOWLIST_PATH = process.env.ALLOWLIST_PATH || "/data/allowlist.json";

if (!ADMIN_SECRET) {
  console.error("RELAY_ADMIN_SECRET is required");
  process.exit(1);
}

// --- Allowlist persistence ---

interface Allowlist {
  pubkeys: Record<string, true>;
  ips: Record<string, true>;
}

function loadAllowlist(): Allowlist {
  try {
    if (existsSync(ALLOWLIST_PATH)) {
      return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf-8"));
    }
  } catch (err) {
    console.error(`Failed to load allowlist: ${err}`);
  }
  return { pubkeys: {}, ips: {} };
}

function saveAllowlist(list: Allowlist): void {
  const dir = dirname(ALLOWLIST_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(list, null, 2));
}

// Initialize allowlist file if missing
if (!existsSync(ALLOWLIST_PATH)) {
  saveAllowlist({ pubkeys: {}, ips: {} });
}

// --- Auth & IP check ---

function getClientIp(req: Request, server: any): string {
  // Check X-Forwarded-For first (behind reverse proxy)
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  // Bun server provides remote address
  const addr = server.requestIP(req);
  return addr?.address || "unknown";
}

function isAuthorized(req: Request, clientIp: string): { ok: boolean; error?: string } {
  // Check IP
  if (!ALLOWED_IPS.includes(clientIp) && !ALLOWED_IPS.includes("0.0.0.0")) {
    return { ok: false, error: `IP ${clientIp} not allowed` };
  }

  // Check Bearer token
  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${ADMIN_SECRET}`) {
    return { ok: false, error: "Invalid or missing authorization" };
  }

  return { ok: true };
}

// --- Server ---

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const method = req.method;

    // Health check (no auth)
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // All admin routes require auth
    if (url.pathname.startsWith("/admin/")) {
      const clientIp = getClientIp(req, server);
      const auth = isAuthorized(req, clientIp);
      if (!auth.ok) {
        console.warn(`[admin] Unauthorized request from ${clientIp}: ${auth.error}`);
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // --- POST /admin/allow ---
    if (url.pathname === "/admin/allow" && method === "POST") {
      const body = (await req.json()) as { pubkey?: string; ip?: string };
      const list = loadAllowlist();
      let existed = false;

      if (body.pubkey) {
        existed = !!list.pubkeys[body.pubkey];
        list.pubkeys[body.pubkey] = true;
      }
      if (body.ip) {
        existed = existed || !!list.ips[body.ip];
        list.ips[body.ip] = true;
      }

      saveAllowlist(list);
      console.log(`[admin] Added: pubkey=${body.pubkey || "-"} ip=${body.ip || "-"}`);
      return new Response(JSON.stringify({ ok: true }), {
        status: existed ? 200 : 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- DELETE /admin/allow ---
    if (url.pathname === "/admin/allow" && method === "DELETE") {
      const body = (await req.json()) as { pubkey?: string; ip?: string };
      const list = loadAllowlist();
      let found = false;

      if (body.pubkey) {
        found = !!list.pubkeys[body.pubkey];
        delete list.pubkeys[body.pubkey];
      }
      if (body.ip) {
        found = found || !!list.ips[body.ip];
        delete list.ips[body.ip];
      }

      saveAllowlist(list);
      console.log(`[admin] Removed: pubkey=${body.pubkey || "-"} ip=${body.ip || "-"}`);
      return new Response(JSON.stringify({ ok: true }), {
        status: found ? 200 : 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- GET /admin/allow ---
    if (url.pathname === "/admin/allow" && method === "GET") {
      const list = loadAllowlist();
      return Response.json({
        pubkeys: Object.keys(list.pubkeys),
        ips: Object.keys(list.ips),
        count: {
          pubkeys: Object.keys(list.pubkeys).length,
          ips: Object.keys(list.ips).length,
        },
      });
    }

    // --- POST /admin/allow/sync ---
    if (url.pathname === "/admin/allow/sync" && method === "POST") {
      const body = (await req.json()) as { pubkeys?: string[]; ips?: string[] };
      const oldList = loadAllowlist();
      const oldPubkeys = new Set(Object.keys(oldList.pubkeys));
      const oldIps = new Set(Object.keys(oldList.ips));

      const newPubkeys = new Set(body.pubkeys || []);
      const newIps = new Set(body.ips || []);

      const newList: Allowlist = { pubkeys: {}, ips: {} };
      for (const pk of newPubkeys) newList.pubkeys[pk] = true;
      for (const ip of newIps) newList.ips[ip] = true;

      saveAllowlist(newList);

      const addedPk = [...newPubkeys].filter((pk) => !oldPubkeys.has(pk)).length;
      const removedPk = [...oldPubkeys].filter((pk) => !newPubkeys.has(pk)).length;
      const addedIp = [...newIps].filter((ip) => !oldIps.has(ip)).length;
      const removedIp = [...oldIps].filter((ip) => !oldIps.has(ip)).length;

      console.log(
        `[admin] Sync: +${addedPk} -${removedPk} pubkeys, +${addedIp} -${removedIp} IPs`
      );

      return Response.json({
        added: addedPk + addedIp,
        removed: removedPk + removedIp,
        total: {
          pubkeys: newPubkeys.size,
          ips: newIps.size,
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[admin] Listening on port ${PORT}`);
console.log(`[admin] Allowed IPs: ${ALLOWED_IPS.join(", ")}`);
console.log(`[admin] Allowlist path: ${ALLOWLIST_PATH}`);
