#!/usr/bin/env node
import('../lib/skills.js').then(async (mod) => {
  const { SkillStore, buildSkillSection } = mod;
  const store = new SkillStore();
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  switch (cmd) {
    case 'list':
    case 'ls': {
      const skills = store.list();
      console.log(`\n📚 Total: ${skills.length} skill\n`);
      for (const s of skills) {
        console.log(`  ${s.id} | ${s.name} | ${s.successes||0}/${s.uses||0} | ${s.source||'local'}`);
      }
      console.log('');
      break;
    }
    case 'show':
    case 'read': {
      if (!args[0]) return console.log('Usage: skill-manager show <id>');
      const content = store.read(args[0]);
      console.log(content || `❌ Skill "${args[0]}" tidak ditemukan`);
      break;
    }
    case 'search':
    case 'find': {
      if (!args[0]) return console.log('Usage: skill-manager search <query>');
      const q = args.join(' ');
      const results = store.find(q, 10);
      if (!results.length) return console.log(`❌ Tidak ada cocok untuk "${q}"`);
      console.log(`\n🔍 ${results.length} skill cocok:\n`);
      results.forEach(s => console.log(`  ${s.id} — ${s.name}\n    trigger: ${String(s.trigger||'').slice(0,100)}`));
      break;
    }
    case 'save': {
      const opts = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) { opts[args[i].slice(2)] = args[i+1]; i++; }
      }
      if (!opts.name || !opts.procedure) return console.log('Usage: skill-manager save --name "..." --trigger "..." --tags "..." --procedure "..."');
      const r = store.save({
        name: opts.name,
        trigger: opts.trigger || opts.name,
        procedure: opts.procedure,
        tags: (opts.tags||'').split(',').map(t=>t.trim()).filter(Boolean),
        examples: opts.examples ? [opts.examples] : []
      });
      console.log(`✅ Skill tersimpan: ${r.id}\n   Path: ${r.path}`);
      break;
    }
    case 'delete':
    case 'rm': {
      if (!args[0]) return console.log('Usage: skill-manager delete <id>');
      console.log(store.delete(args[0]) ? `✅ Dihapus: ${args[0]}` : `❌ Tidak ada: ${args[0]}`);
      break;
    }
    case 'stats': {
      const s = store.stats();
      console.log(`\n📊 Total: ${s.total} | Uses: ${s.totalUses} | OK: ${s.totalSuccesses} | Fail: ${s.totalFailures} | Failing: ${s.failing}\n`);
      break;
    }
    case 'render': {
      if (!args[0]) return console.log('Usage: skill-manager render <query>');
      const section = buildSkillSection(store, args.join(' '));
      console.log(section || '(tidak ada skill relevan)');
      break;
    }
    default: {
      console.log(`
Usage: skill-manager <command> [args]

Commands:
  list                              List semua skill
  show <id>                         Lihat isi skill
  search <query>                    Cari skill
  save --name N --procedure P       Simpan skill baru
       [--trigger T] [--tags a,b,c]
  delete <id>                       Hapus skill
  stats                             Statistik
  render <query>                    Test skill match

Contoh:
  skill-manager list
  skill-manager search "javascript"
  skill-manager save --name "fix-cdn" --trigger "tombol mati" --tags "js,debug" --procedure "1. Buka Console 2. Cek CDN"
      `);
    }
  }
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
