import { webSearch } from "./web.js";

const QUERIES = [
  {
    name: "dxy",
    q: "current US Dollar Index DXY price today value",
    label: "DXY (US Dollar Index)",
  },
  {
    name: "events",
    q: "economic calendar high impact events next 48 hours forex USD",
    label: "Kalender Ekonomi 48 Jam",
  },
];

export async function fetchMacroEnrichment(exaKey, log = () => {}) {
  if (!exaKey) {
    log("⚠️ EXA key kosong — skip enrichment");
    return { dxy: null, events: null, ok: false };
  }

  const out = { dxy: null, events: null, ok: true, fetched: [] };

  for (const { name, q, label } of QUERIES) {
    try {
      log(`🔎 Fetching ${label}...`);
      const t0 = Date.now();
      const results = await webSearch(q, 3, exaKey);
      const ms = Date.now() - t0;
      if (!results || !results.length) {
        out[name] = null;
        log(`   ${label}: 0 hasil (${ms}ms)`);
        continue;
      }
      const snippets = results.map((r, i) =>
        `${i + 1}. [${r.url || "?"}] ${r.title || ""}\n   ${(r.snippet || r.content || "").slice(0, 400).replace(/\n+/g, " ")}`
      ).join("\n");
      out[name] = snippets;
      out.fetched.push({ name, count: results.length, ms });
      log(`   ${label}: ${results.length} hasil (${ms}ms)`);
    } catch (e) {
      out[name] = null;
      out.ok = false;
      log(`   ${label}: ERROR ${e.message}`);
    }
  }

  return out;
}

export function formatMacroEnrichment(enrich) {
  if (!enrich || !enrich.ok) return "";
  const parts = [];

  if (enrich.dxy || enrich.events) {
    parts.push("\n\n=== DATA TAMBAHAN (dari web search EXA, real-time) ===");
    parts.push("Instruksi: Pakai data di bawah untuk melengkapi FUNDAMENTAL. Kalau angka tidak muncul eksplisit di snippet, tulis 'tidak tersedia' JANGAN mengarang.");
  }

  if (enrich.dxy) {
    parts.push("\n[DXY — US Dollar Index]");
    parts.push(enrich.dxy);
  } else {
    parts.push("\n[DXY — US Dollar Index]");
    parts.push("tidak tersedia dari web search");
  }

  if (enrich.events) {
    parts.push("\n[EVENTS — Kalender Ekonomi 48 Jam]");
    parts.push(enrich.events);
  } else {
    parts.push("\n[EVENTS — Kalender Ekonomi 48 Jam]");
    parts.push("tidak tersedia dari web search");
  }

  parts.push("=== END DATA TAMBAHAN ===\n");
  return parts.join("\n");
}
