import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { CONFIG_FILE, SKILLS_DIR, SKILLS_INDEX, IS_LEGACY } from "./paths.js";

function sh(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: "utf8", stdio: "pipe", timeout: 10000, shell: "/bin/bash" }).trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "").toString().trim(), err: (e.stderr || e.message || "").toString().trim() };
  }
}

async function tryFetch(url, opts = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(opts.timeout || 5000), ...opts });
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function isTermux() {
  return process.platform === "android" || !!process.env.PREFIX?.includes("com.termux");
}

export async function runDoctor({ fix = false, pkgRoot, pkgVersion }) {
  const results = [];
  const add = (category, name, status, message, fixFn) => {
    results.push({ category, name, status, message, fixFn: fix ? fixFn : null });
  };

  // ── 1. Environment
  const nv = process.version.slice(1);
  const [nMj, nMm] = nv.split(".").map(Number);
  const nOk = nMj > 22 || (nMj === 22 && nMm >= 5);
  add("Environment", "Node.js", nOk ? "ok" : "fail", `v${nv}${nOk ? "" : " (butuh >= 22.5)"}`);
  add("Environment", "Platform", "ok", `${process.platform}/${process.arch}${isTermux() ? " (Termux)" : ""}`);
  add("Environment", "Version", "ok", `v${pkgVersion}`);
  add("Environment", "Config mode", "ok", IS_LEGACY ? "Legacy" : "NPM (~/.config/codeclaw/)");

  // ── 2. Config
  if (!fs.existsSync(CONFIG_FILE)) {
    const ex = path.join(pkgRoot, "config.example.json");
    add("Config", "File", "fail", `Missing: ${CONFIG_FILE}`, () => {
      if (!fs.existsSync(ex)) return "config.example.json hilang dari package";
      fs.copyFileSync(ex, CONFIG_FILE);
      return `Created: ${CONFIG_FILE}`;
    });
  } else {
    add("Config", "File", "ok", CONFIG_FILE);
    let cfg = null;
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      add("Config", "Valid JSON", "ok", `${(fs.statSync(CONFIG_FILE).size / 1024).toFixed(1)} KB`);
    } catch (e) {
      add("Config", "Valid JSON", "fail", `Parse: ${e.message}`);
    }
    if (cfg) {
      const prov = cfg.models?.providers?.["9router"];
      if (!prov) add("Config", "Provider 9router", "warn", "Tidak ada models.providers.9router");
      else {
        const k = prov.apiKey || "";
        const bad = /REPLACE|YOUR_|ISI_|xxx/i.test(k) || !k;
        add("Config", "9router key", bad ? "warn" : "ok", bad ? `Placeholder: ${k.slice(0, 20) || "(kosong)"}` : `Set (${k.slice(0, 8)}...)`);
        add("Config", "9router url", prov.baseUrl ? "ok" : "fail", prov.baseUrl || "(kosong)");
      }
      const tg = cfg.channels?.telegram?.accounts?.default;
      if (!tg) add("Config", "Telegram", "fail", "channels.telegram.accounts.default tidak ada");
      else {
        const t = tg.botToken || "";
        const bad = /REPLACE|YOUR_|ISI_/i.test(t) || !t;
        add("Config", "Telegram token", bad ? "fail" : "ok", bad ? `Placeholder` : `Set (${t.slice(0, 10)}...)`);
        const ids = tg.allowedUserIds || [];
        add("Config", "Allowed users", ids.length > 0 ? "ok" : "warn", ids.length > 0 ? `${ids.length} user` : "Kosong (semua reject)");
      }
    }
  }

  // ── 3. Network
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    const prov = cfg.models?.providers?.["9router"];
    if (prov?.baseUrl) {
      const url = prov.baseUrl.replace(/\/v1\/?$/, "") + "/v1/models";
      const r = await tryFetch(url, { headers: { "Authorization": `Bearer ${prov.apiKey}` } });
      add("Network", "9router", r.ok ? "ok" : "fail", r.ok ? `HTTP ${r.status}` : `Unreachable: ${r.error}`);
    }
    const t = cfg.channels?.telegram?.accounts?.default?.botToken;
    if (t && !/REPLACE|YOUR_|ISI_/.test(t)) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(5000) });
        const b = await r.json();
        add("Network", "Telegram API", b.ok ? "ok" : "fail", b.ok ? `@${b.result.username}` : `${b.description || "invalid"}`);
      } catch (e) {
        add("Network", "Telegram API", "fail", e.message);
      }
    }
  } catch {}

  // ── 4. Runtime
  const pm2 = sh("pm2 --version");
  if (!pm2.ok) {
    add("Runtime", "PM2", "warn", "Tidak terinstall — npm i -g pm2");
  } else {
    add("Runtime", "PM2", "ok", `v${pm2.out}`);
    const j = sh("pm2 jlist");
    if (j.ok) {
      try {
        const procs = JSON.parse(j.out);
        const cc = procs.find(p => p.name === "codeclaw-tg");
        if (!cc) {
          add("Runtime", "codeclaw-tg", "warn", "Tidak di PM2", () => {
            sh(`pm2 start "${process.argv[1]}" --name codeclaw-tg -- tg`);
            sh("pm2 save");
            return "Started di PM2";
          });
        } else {
          const st = cc.pm2_env?.status;
          const rt = cc.pm2_env?.restart_time || 0;
          add("Runtime", "codeclaw-tg", st === "online" ? "ok" : "warn", `${st}${rt ? ` (${rt}x restart)` : ""}`,
            st !== "online" ? () => { sh("pm2 restart codeclaw-tg"); return "Restarted"; } : null);
        }
      } catch {}
    }
  }

  // Legacy orphans
  const leg = (sh("pgrep -f 'node telegram.js'").out || "").split("\n").filter(Boolean).length;
  const sup = (sh("pgrep -f 'run.sh __supervise'").out || "").split("\n").filter(Boolean).length;
  if (leg + sup > 0) {
    add("Runtime", "Legacy orphans", "warn", `${leg} telegram.js + ${sup} supervisor (409 risk)`, () => {
      sh("pkill -f 'node telegram.js'");
      sh("pkill -f 'run.sh __supervise'");
      return "Killed orphans";
    });
  } else {
    add("Runtime", "Orphans", "ok", "Tidak ada");
  }

  // ── 5. Data
  if (!fs.existsSync(SKILLS_DIR)) {
    add("Data", "Skills dir", "warn", `Missing: ${SKILLS_DIR}`, () => {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      return "Created";
    });
  } else {
    const cnt = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".md")).length;
    add("Data", "Skills", "ok", `${cnt} file`);
  }
  if (fs.existsSync(SKILLS_INDEX)) {
    try {
      const i = JSON.parse(fs.readFileSync(SKILLS_INDEX, "utf8"));
      add("Data", "Skills index", "ok", `${Object.keys(i.skills || {}).length} entries`);
    } catch (e) {
      add("Data", "Skills index", "warn", `Corrupt: ${e.message}`, () => {
        fs.unlinkSync(SKILLS_INDEX);
        return "Deleted (rebuild next start)";
      });
    }
  }

  // ── 6. Cron
  const cron = (sh("crontab -l 2>/dev/null | grep -c 'trade-auto\\|research-auto'").out || "0").trim();
  add("Cron", "Trade/Research", cron !== "0" ? "ok" : "warn", cron !== "0" ? `${cron} job` : "Belum setup (optional)");

  const ok = results.filter(r => r.status === "ok").length;
  const warn = results.filter(r => r.status === "warn").length;
  const fail = results.filter(r => r.status === "fail").length;
  return { results, ok, warn, fail, fixMode: fix };
}

export function printDoctorReport(report) {
  const { results, ok, warn, fail, fixMode } = report;
  const groups = {};
  for (const r of results) (groups[r.category] = groups[r.category] || []).push(r);
  console.log(`\n🩺 CodeClaw Doctor${fixMode ? " [FIX MODE]" : ""}\n${"═".repeat(50)}\n`);
  for (const [cat, items] of Object.entries(groups)) {
    console.log(`【${cat}】`);
    for (const r of items) {
      const icon = r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️ " : "❌";
      console.log(`  ${icon} ${r.name}: ${r.message}`);
    }
    console.log();
  }
  console.log("═".repeat(50));
  console.log(`✅ ${ok} ok | ⚠️  ${warn} warn | ❌ ${fail} fail`);
  if (fixMode) {
    const fixable = results.filter(r => r.fixFn);
    if (!fixable.length) { console.log("\n✅ Tidak ada yang perlu difix."); return; }
    console.log(`\n🔧 Applying ${fixable.length} fix(es)...\n`);
    for (const r of fixable) {
      try { const m = r.fixFn(); if (m) console.log(`  ✅ ${r.name}: ${m}`); }
      catch (e) { console.log(`  ❌ ${r.name}: ${e.message}`); }
    }
  } else if (warn > 0 || fail > 0) {
    console.log("\n💡 Auto-fix: codeclaw doctor --fix\n");
  }
}
