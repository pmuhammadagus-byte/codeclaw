#!/usr/bin/env node
import fs from "node:fs";
import { MEMORY_FILE, ensureDirs } from "../lib/paths.js";
import { SkillStore } from "../lib/skills.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limit = parseInt(args.find(a => a.startsWith("--limit="))?.split("=")[1] || "0", 10);

// Normalize: strip [RISET], lowercase, remove punctuation, collapse spaces
function normalizeTopic(t) {
  return String(t || "")
    .replace(/^\[RISET\]\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Noise filter
function isNoise(task, insight) {
  const t = task.toLowerCase().trim();
  // Skip very short / generic task
  if (t.length < 15) return true;
  if (/^(ya|ok|oke|hi|halo|halo$|test|coba|testing|tes|yup|no|iya|hello)$/i.test(t)) return true;
  // Skip task tanpa kata substansial (>4 char)
  const words = t.split(/\s+/).filter(w => w.length > 4);
  if (words.length < 2) return true;
  // Skip insight sangat pendek
  if (!insight || insight.length < 40) return true;
  // Skip insight generik
  if (/^(ok|ya|sudah|done|selesai|siap|berhasil)\.?$/i.test(insight.trim())) return true;
  return false;
}

async function main() {
  ensureDirs();

  if (!fs.existsSync(MEMORY_FILE)) {
    console.log(`❌ Memory file tidak ada: ${MEMORY_FILE}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(MEMORY_FILE, "utf8").split("\n").filter(Boolean);
  console.log(`📖 ${lines.length} memory entries`);
  if (dryRun) console.log(`🔍 DRY-RUN (tidak save)`);

  const store = new SkillStore();
  const beforeCount = store.list().length;

  // ── Group by normalized topic, keep LATEST insight per topic
  const topicMap = new Map(); // topic → { task, insight, ts, raw }
  let noiseSkipped = 0;

  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      const rawTask = String(m.task || "").trim();
      const insight = String(m.insight || "").trim();

      if (isNoise(rawTask, insight)) { noiseSkipped++; continue; }

      const key = normalizeTopic(rawTask);
      if (!key || key.length < 10) { noiseSkipped++; continue; }

      // Keep latest (by ts) or first if no ts
      const ts = m.ts || m.created_at || "1970-01-01";
      if (!topicMap.has(key) || topicMap.get(key).ts < ts) {
        topicMap.set(key, { task: rawTask, insight, ts, raw: m });
      }
    } catch {}
  }

  console.log(`\n📊 Setelah grouping:`);
  console.log(`   Unique topics: ${topicMap.size}`);
  console.log(`   Noise skipped: ${noiseSkipped}`);

  // ── Save 1 skill per unique topic
  let saved = 0, dupSkipped = 0;
  const savedNames = [];

  for (const [key, { task, insight, ts }] of topicMap) {
    // Dedupe against EXISTING skills (bukan memory) — pakai normalized key
    const existing = store.find(key, 5);
    const isDup = existing.some(s => {
      const hay = normalizeTopic((s.name || "") + " " + (s.trigger || ""));
      return hay.includes(key.slice(0, 20)) || key.includes(hay.slice(0, 20));
    });
    if (isDup) { dupSkipped++; continue; }

    // Tags dari topic + insight
    const tags = [...new Set(
      (task + " " + insight).toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 4 && w.length < 20)
    )].slice(0, 6);

    const cleanTask = task.replace(/^\[RISET\]\s*/i, "").trim();
    const prefix = task.toUpperCase().startsWith("[RISET]") ? "riset: " : "memory: ";

    if (!dryRun) {
      try {
        store.save({
          name: prefix + cleanTask.slice(0, 55),
          trigger: cleanTask + " | " + insight.slice(0, 120),
          procedure: "## Insight\n\n" + insight + "\n\n## Sumber\n\nDari memory (task: " + cleanTask + ").",
          tags,
          examples: [],
        });
        saved++;
        savedNames.push(cleanTask.slice(0, 60));
      } catch (e) {
        console.log(`⚠️ Save error: ${e.message.slice(0, 80)}`);
      }
    } else {
      saved++;
      savedNames.push(cleanTask.slice(0, 60));
    }
  }

  const afterCount = store.list().length;

  console.log(`\n${"═".repeat(50)}`);
  if (dryRun) {
    console.log(`🔍 WOULD SAVE: ${saved} | DUP (existing): ${dupSkipped} | NOISE: ${noiseSkipped}`);
    if (savedNames.length > 0) {
      console.log(`\nPreview (${Math.min(savedNames.length, 20)}/${savedNames.length}):`);
      savedNames.slice(0, 20).forEach(n => console.log(`  • ${n}`));
    }
  } else {
    console.log(`✅ SAVED: ${saved} | DUP: ${dupSkipped} | NOISE: ${noiseSkipped}`);
    console.log(`📚 Total skills: ${beforeCount} → ${afterCount}`);
  }
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
