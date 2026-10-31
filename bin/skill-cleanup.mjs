#!/usr/bin/env node
import { SkillStore } from "../lib/skills.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const minNameLen = parseInt(args.find(a => a.startsWith("--min-name="))?.split("=")[1] || "40", 10);
const minTrigLen = parseInt(args.find(a => a.startsWith("--min-trigger="))?.split("=")[1] || "80", 10);

const s = new SkillStore();
const all = s.list();

const noise = all.filter(x => {
  const isMemory = (x.name||'').startsWith('memory:') || (x.name||'').startsWith('riset:');
  if (!isMemory) return false;
  return (x.name||'').length < minNameLen || (x.trigger||'').length < minTrigLen;
});

console.log(`🔍 min-name=${minNameLen}, min-trigger=${minTrigLen}`);
console.log(`📊 Total: ${all.length} | Noise candidates: ${noise.length}`);
if (dryRun) {
  console.log(`🔍 DRY-RUN — tidak delete`);
  noise.slice(0, 10).forEach(n => console.log(`  • ${n.name} (${(n.trigger||'').length}c)`));
  return;
}

let deleted = 0;
for (const n of noise) if (s.delete(n.id)) deleted++;
console.log(`✅ Deleted: ${deleted}`);
console.log(`📚 Remaining: ${s.list().length}`);
