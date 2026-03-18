#!/usr/bin/env node

/**
 * strfry write-policy plugin for Commons Hub relay.
 *
 * Checks incoming events against an allowlist of pubkeys and IPs.
 * The allowlist is stored in a JSON file managed by the admin server.
 *
 * Allowlist format:
 * {
 *   "pubkeys": { "<hex-pubkey>": true, ... },
 *   "ips": { "<ip-address>": true, ... }
 * }
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ALLOWLIST_PATH =
  process.env.ALLOWLIST_PATH || "/data/allowlist.json";

// Cache allowlist in memory, reload on change
let allowlist = { pubkeys: {}, ips: {} };
let lastMtime = 0;

function loadAllowlist() {
  try {
    const stat = fs.statSync(ALLOWLIST_PATH);
    if (stat.mtimeMs === lastMtime) return; // unchanged

    const data = fs.readFileSync(ALLOWLIST_PATH, "utf-8");
    allowlist = JSON.parse(data);
    lastMtime = stat.mtimeMs;
    console.error(
      `[write-policy] Loaded allowlist: ${Object.keys(allowlist.pubkeys || {}).length} pubkeys, ${Object.keys(allowlist.ips || {}).length} IPs`
    );
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist yet — empty allowlist (reject all writes)
      allowlist = { pubkeys: {}, ips: {} };
    } else {
      console.error(`[write-policy] Error loading allowlist: ${err.message}`);
    }
  }
}

// Initial load
loadAllowlist();

// Reload every 5 seconds (strfry keeps the plugin process alive)
setInterval(loadAllowlist, 5000);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    console.error("[write-policy] Failed to parse input");
    return;
  }

  if (req.type !== "new") {
    console.error(`[write-policy] Unexpected request type: ${req.type}`);
    return;
  }

  const res = { id: req.event.id };

  // Reload allowlist on each event (cheap stat check)
  loadAllowlist();

  const pubkey = req.event.pubkey;
  const sourceIp = req.sourceInfo || "";

  // Check pubkey allowlist
  if (allowlist.pubkeys && allowlist.pubkeys[pubkey]) {
    res.action = "accept";
    console.log(JSON.stringify(res));
    return;
  }

  // Check IP allowlist
  if (allowlist.ips && allowlist.ips[sourceIp]) {
    res.action = "accept";
    console.log(JSON.stringify(res));
    return;
  }

  // Reject
  res.action = "reject";
  res.msg = "blocked: not on allowlist";
  console.log(JSON.stringify(res));
});
