#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirs, CONFIG_FILE, CONFIG_DIR, DATA_DIR } from "../lib/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const cmd = process.argv[2] || "start";
const argv = process.argv.slice(3);

async function main() {
  ensureDirs();

  // doctor: bypasses config check
  if (cmd === "doctor") {
    const { runDoctor, printDoctorReport } = await import(path.join(PKG_ROOT, "lib", "doctor.js"));
    const fix = argv.includes("--fix");
    const report = await runDoctor({ fix, pkgRoot: PKG_ROOT, pkgVersion: pkg.version });
    printDoctorReport(report);
    process.exit(report.fail > 0 && !fix ? 1 : 0);
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    const ex = path.join(PKG_ROOT, "config.example.json");
    if (fs.existsSync(ex)) {
      fs.copyFileSync(ex, CONFIG_FILE);
      console.log(`✅ Config dibuat: ${CONFIG_FILE}`);
      console.log(`   Edit dulu (token 9router, Telegram), lalu jalankan lagi.`);
      console.log(`   Cek cepat: codeclaw doctor`);
      process.exit(0);
    }
    console.error(`❌ Config tidak ada: ${CONFIG_FILE}`);
    process.exit(1);
  }

  switch (cmd) {
    case "start":
    case "telegram":
    case "tg":
      await import(path.join(PKG_ROOT, "telegram.js"));
      break;
    case "tui":
      await import(path.join(PKG_ROOT, "index.js"));
      break;
    case "skill":
      process.argv = [process.argv[0], "skill-manager", ...argv];
      await import(path.join(PKG_ROOT, "bin", "skill-manager.js"));
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(pkg.version);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(`codeclaw ${pkg.version}

Usage: codeclaw [command]

Commands:
  start, tg      Start telegram bot (default)
  tui            Start TUI mode
  skill <cmd>    Manage skills (list|show|search|save|delete|stats)
  doctor         Diagnose & fix common issues
                 Use --fix to auto-fix safe issues
  version        Show version
  help           Show this help

Config: ${CONFIG_FILE}
Data:   ${DATA_DIR}
`);
      break;
    default:
      console.error(`Unknown command: ${cmd}. Run 'codeclaw help'.`);
      process.exit(1);
  }
}
main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
