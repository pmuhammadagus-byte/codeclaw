// Force IPv4: baca /etc/hosts dulu, fallback DNS family:4
import fs from "node:fs";
import dns from "node:dns";

let cachedHosts = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // 30 detik

function loadHosts() {
  const now = Date.now();
  if (cachedHosts && now - cacheTime < CACHE_TTL) return cachedHosts;
  const map = new Map();
  try {
    const content = fs.readFileSync("/etc/hosts", "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const ip = parts[0];
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
      for (const host of parts.slice(1)) {
        if (!map.has(host)) map.set(host, ip);
      }
    }
  } catch {}
  cachedHosts = map;
  cacheTime = now;
  return map;
}

export function hostsLookup(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  const hosts = loadHosts();
  if (hosts.has(hostname)) {
    return callback(null, hosts.get(hostname), 4);
  }
  dns.lookup(hostname, { ...options, family: 4 }, callback);
}

// Setup undici global dispatcher (Node fetch pakai ini)
export async function setupIPv4Dispatcher() {
  try {
    const { Agent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new Agent({
      connect: { lookup: hostsLookup },
      keepAliveTimeout: 10000,
      headersTimeout: 60000,
      bodyTimeout: 180000,
    }));
    return true;
  } catch (e) {
    console.log("[ipv4-lookup] undici tidak tersedia:", e.message);
    return false;
  }
}
