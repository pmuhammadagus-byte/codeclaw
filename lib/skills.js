import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SKILLS_DIR = path.join(process.env.HOME || "/root", "codeclaw", "skills");
const SKILLS_INDEX = path.join(SKILLS_DIR, "_index.json");
const AGENT_SKILLS_DIR = path.join(process.env.HOME || "/root", "codeclaw", ".agents", "skills");

export class SkillStore {
  constructor() {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    this.index = this._loadIndex();
    this._loadAgentSkills();
  }

  _loadIndex() {
    if (!fs.existsSync(SKILLS_INDEX)) return { skills: {}, version: 1 };
    try { return JSON.parse(fs.readFileSync(SKILLS_INDEX, "utf8")); }
    catch { return { skills: {}, version: 1 }; }
  }


  _loadAgentSkills() {
    if (!fs.existsSync(AGENT_SKILLS_DIR)) return;
    let folders = [];
    try {
      folders = fs.readdirSync(AGENT_SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch { return; }
    let added = 0;
    for (const folder of folders) {
      const skillMd = path.join(AGENT_SKILLS_DIR, folder, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const id = "agent:" + folder;
      if (this.index.skills[id]) continue;
      let content = "";
      try { content = fs.readFileSync(skillMd, "utf8"); } catch { continue; }
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      const meta = {};
      if (fmMatch) {
        for (const line of fmMatch[1].split("\n")) {
          const m = line.match(/^(\w+):\s*['"]?(.*?)['"]?\s*$/);
          if (m) meta[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
        }
      }
      const desc = meta.description || "";
      const triggerMatch = desc.match(/Triggers? on:\s*(.+)/i);
      const triggerWords = triggerMatch ? triggerMatch[1].replace(/"/g, "") : "";
      const tags = triggerWords.split(/[,;]/).map(t => t.trim().toLowerCase()).filter(t => t.length >= 3);
      this.index.skills[id] = {
        id,
        name: meta.name || folder,
        trigger: desc,
        tags: [folder.toLowerCase(), ...tags],
        path: skillMd,
        created: Date.now(),
        uses: 0,
        successes: 0,
        failures: 0,
        lastUsed: null,
        source: "agents",
      };
      added++;
    }
    if (added > 0) {
      this._saveIndex();
      console.log("[skills] Loaded " + added + " agent skill(s) dari .agents/skills/");
    }
  }

    _saveIndex() { fs.writeFileSync(SKILLS_INDEX, JSON.stringify(this.index, null, 2)); }

  _taskId(task) {
    const norm = task.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
    return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 12);
  }

  save({ name, trigger, procedure, examples = [], tags = [] }) {
    if (!name || !procedure) throw new Error("name and procedure required");
    const id = this._taskId(trigger || name);
    const skillPath = path.join(SKILLS_DIR, `${id}.md`);
    const content = `# ${name}\n\n**Trigger:** ${trigger || name}\n\n**Tags:** ${tags.join(", ") || "(none)"}\n\n**Created:** ${new Date().toISOString()}\n**Uses:** 0 | **Successes:** 0 | **Failures:** 0\n\n---\n\n## Procedure\n\n${procedure}\n\n${examples.length ? `## Examples\n\n${examples.map((e, i) => `### Example ${i + 1}\n${e}`).join("\n\n")}` : ""}\n`;
    fs.writeFileSync(skillPath, content, "utf8");
    this.index.skills[id] = { id, name, trigger, tags, path: skillPath, created: Date.now(), uses: 0, successes: 0, failures: 0, lastUsed: null };
    this._saveIndex();
    return { id, name, path: skillPath };
  }

  find(task, limit = 3) {
    const tokens = (task.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || []);
    if (!tokens.length) return [];
    const scores = [];
    for (const [id, skill] of Object.entries(this.index.skills)) {
      const haystack = `${skill.name} ${skill.trigger} ${(skill.tags || []).join(" ")}`.toLowerCase();
      let score = 0;
      for (const t of tokens) if (haystack.includes(t)) score++;
      const total = skill.successes + skill.failures;
      if (total > 0) score = score * (0.5 + skill.successes / total);
      if (score > 0) scores.push({ skill, score });
    }
    return scores.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.skill);
  }

  read(id) {
    const skill = this.index.skills[id];
    if (!skill || !fs.existsSync(skill.path)) return null;
    return fs.readFileSync(skill.path, "utf8");
  }

  recordUse(id, success) {
    if (!this.index.skills[id]) return;
    const s = this.index.skills[id];
    s.uses = (s.uses || 0) + 1;
    if (success) s.successes = (s.successes || 0) + 1;
    else s.failures = (s.failures || 0) + 1;
    s.lastUsed = Date.now();
    this._saveIndex();
    this._syncMdStats(id);
  }

  _syncMdStats(id) {
    const skill = this.index.skills[id];
    if (!skill || !fs.existsSync(skill.path)) return;
    let content = fs.readFileSync(skill.path, "utf8");
    content = content.replace(
      /\*\*Uses:\*\* \d+ \| \*\*Successes:\*\* \d+ \| \*\*Failures:\*\* \d+/,
      `**Uses:** ${skill.uses} | **Successes:** ${skill.successes} | **Failures:** ${skill.failures}`
    );
    fs.writeFileSync(skill.path, content, "utf8");
  }

  list() { return Object.values(this.index.skills).sort((a, b) => (b.successes || 0) - (a.successes || 0)); }

  delete(id) {
    const skill = this.index.skills[id];
    if (!skill) return false;
    try { fs.unlinkSync(skill.path); } catch {}
    delete this.index.skills[id];
    this._saveIndex();
    return true;
  }

  failingSkills(minFailures = 2) {
    return Object.values(this.index.skills).filter(s => s.failures >= minFailures && s.failures > s.successes);
  }

  update(id, newContent) {
    const skill = this.index.skills[id];
    if (!skill) return false;
    fs.writeFileSync(skill.path, newContent, "utf8");
    return true;
  }

  stats() {
    const skills = Object.values(this.index.skills);
    return {
      total: skills.length,
      totalUses: skills.reduce((a, s) => a + (s.uses || 0), 0),
      totalSuccesses: skills.reduce((a, s) => a + (s.successes || 0), 0),
      totalFailures: skills.reduce((a, s) => a + (s.failures || 0), 0),
      failing: this.failingSkills().length,
    };
  }
}

export function buildSkillSection(store, taskDescription) {
  const relevant = store.find(taskDescription, 2);
  if (!relevant.length) return "";
  const parts = ["\n\n## SKILLS RELEVAN (dari pengalaman sebelumnya)"];
  for (const skill of relevant) {
    const content = store.read(skill.id);
    if (!content) continue;
    const m = content.match(/## Procedure\n\n([\s\S]*?)(?:\n## |$)/);
    let procedure = m ? m[1].trim() : "";
    if (!procedure) {
      const noFm = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trim();
      procedure = noFm.slice(0, 2500);
    }
    if (!procedure) continue;
    parts.push(`### ${skill.name}\nTrigger: ${skill.trigger}\n${procedure}`);
  }
  return parts.join("\n\n");
}
