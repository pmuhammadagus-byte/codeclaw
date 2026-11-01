#!/usr/bin/env node
// Cleanup skill store: hapus memory:* (noise) dan riset:* uses=0
// SAFE: dry-run default, backup otomatis, tidak sentuh telegram.js

import fs from 'node:fs';
import { SkillStore } from '../lib/skills.js';

const execute = process.argv.includes('--execute');

const store = new SkillStore();
const list = store.list();

const cat = (s) => {
  const n = s.name || '';
  if (/^memory:/i.test(n)) return 'memory';
  if (/^riset:/i.test(n)) return 'riset';
  if (/trade|xau|gold/i.test(n)) return 'trade';
  if (/debug|error|fix|bug/i.test(n)) return 'debug';
  return 'other';
};

const groups = { memory: [], riset: [], trade: [], debug: [], other: [] };
for (const s of list) groups[cat(s)].push(s);

console.log('=== CURRENT STATE ===');
console.log('Total:', list.length);
for (const [k, v] of Object.entries(groups)) console.log(`  ${k.padEnd(6)}: ${v.length}`);
console.log('');

// Decide
const toDelete = [], toKeep = [];
for (const s of list) {
  const c = cat(s);
  if (c === 'memory') { toDelete.push(s); continue; }
  if (c === 'riset' && (s.uses || 0) === 0) { toDelete.push(s); continue; }
  toKeep.push(s);
}

console.log('=== CLEANUP PLAN ===');
console.log('Delete:', toDelete.length);
console.log('  - memory:* (semua):', groups.memory.length);
console.log('  - riset:* uses=0 :', toDelete.filter(s => cat(s) === 'riset').length);
console.log('Keep:', toKeep.length);
console.log('  - trade :', groups.trade.length);
console.log('  - debug :', groups.debug.length);
console.log('  - other :', groups.other.length);
console.log('  - riset uses>0:', groups.riset.filter(s => (s.uses||0) > 0).length);
console.log('');

if (!execute) {
  console.log('=== DRY RUN (tidak ada perubahan) ===');
  console.log('');
  console.log('Sample yang AKAN DIHAPUS:');
  toDelete.slice(0, 10).forEach(s => console.log('  -', (s.name||'').slice(0, 70)));
  console.log('');
  console.log('Untuk eksekusi: node scripts/cleanup-skills.mjs --execute');
  process.exit(0);
}

// === EXECUTE ===
const backupDir = `skills-backup-${Date.now()}`;
fs.mkdirSync(backupDir, { recursive: true });
let backed = 0;
for (const s of toDelete) {
  if (s.path && fs.existsSync(s.path)) {
    fs.copyFileSync(s.path, `${backupDir}/${s.id}.md`);
    backed++;
  }
}
console.log(`📦 Backup: ${backupDir}/ (${backed} file)`);

let deleted = 0, failed = 0;
for (const s of toDelete) {
  try {
    if (s.path && fs.existsSync(s.path)) fs.unlinkSync(s.path);
    delete store.index.skills[s.id];
    deleted++;
  } catch (e) { console.error(`fail ${s.id}:`, e.message); failed++; }
}
store._saveIndex();

console.log('');
console.log(`✅ Deleted: ${deleted}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📦 Remaining: ${Object.keys(store.index.skills).length}`);
console.log(`💾 Backup  : ${backupDir}/`);
