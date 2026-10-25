#!/usr/bin/env node
/**
 * gen-badges.mjs — generator badge SVG CodeClaw Pro.
 *
 * Prinsip: angka di badge adalah HASIL TURUNAN, bukan input manual.
 *   tools  -> dibaca dari lib/tools.js (TOOL_DEFINITIONS.length)
 *   tests  -> hasil `npm test` sesungguhnya (bukan klaim)
 *   node   -> package.json > engines.node
 *   versi  -> package.json > version
 *   lisensi-> keberadaan file LICENSE + jenisnya
 *
 * Jalankan: node scripts/gen-badges.mjs [--no-test]
 * Output:   assets/badges/*.svg  +  assets/badges/all.svg
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "badges");
const SKIP_TEST = process.argv.includes("--no-test");

/* ---------- palet (samakan dengan banner.svg / terminal.svg) ---------- */
const C = {
  labelBg: "#0f1c2b",
  valueBg: "#12293b",
  border: "#1e3348",
  label: "#93a9c6",
  accent: "#22d3ee",
  green: "#34d399",
  amber: "#fbbf24",
  white: "#e8f4ff",
};

/* ---------- util teks mono ---------- */
// advance 'DejaVu Sans Mono' ≈ 0.6023em; dibulatkan ke atas + margin aman
const CH = 6.7;
const PAD = 9;
const textW = (s) => Math.ceil(String(s).length * CH);
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- fungsi: baca fakta ---------- */
function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

/** Jumlah tool: utamakan import asli; fallback regex kalau import gagal. */
async function countTools() {
  try {
    const mod = await import(path.join(ROOT, "lib", "tools.js"));
    if (Array.isArray(mod.TOOL_DEFINITIONS) && mod.TOOL_DEFINITIONS.length) {
      return { n: mod.TOOL_DEFINITIONS.length, src: "import" };
    }
  } catch (e) {
    /* lanjut ke fallback */
  }
  const src = fs.readFileSync(path.join(ROOT, "lib", "tools.js"), "utf8");
  const names = src.match(/function:\s*\{\s*name:\s*"([a-zA-Z_]+)"/g) || [];
  const uniq = new Set(names.map((m) => m.replace(/.*name:\s*"/, "").replace(/"$/, "")));
  return { n: uniq.size, src: "regex" };
}

/** Jalankan test asli dan baca hitungan pass. */
function runTests() {
  if (SKIP_TEST) return null;
  try {
    const out = execFileSync("npm", ["test"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180000,
    });
    return parseTap(out);
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`;
    const p = parseTap(out);
    if (p.total) return { ...p, failedRun: true };
    return null;
  }
}

function parseTap(out) {
  const grab = (k) => {
    const m = out.match(new RegExp(`^#\\s*${k}\\s+(\\d+)$`, "m"));
    return m ? Number(m[1]) : 0;
  };
  return { total: grab("tests"), pass: grab("pass"), fail: grab("fail") };
}

/**
 * Hitung dependency NYATA dari package.json.
 * required = dependencies (wajib). optional = optionalDependencies (tidak wajib).
 * Badge hanya boleh mengklaim "0 required" kalau ini benar-benar kosong.
 */
function countDeps(pkg) {
  const req = Object.keys(pkg.dependencies || {});
  const opt = Object.keys(pkg.optionalDependencies || {});
  const dev = Object.keys(pkg.devDependencies || {});
  return { required: req.length, requiredNames: req, optional: opt.length, optionalNames: opt, dev: dev.length };
}

function detectLicense() {
  const files = fs.readdirSync(ROOT).filter((f) => /^LICEN[CS]E(\.|$)/i.test(f));
  if (!files.length) return { has: false, name: "unknown" };
  const body = fs.readFileSync(path.join(ROOT, files[0]), "utf8");
  if (/MIT License/i.test(body)) return { has: true, name: "MIT", file: files[0] };
  if (/Apache License/i.test(body)) return { has: true, name: "Apache-2.0", file: files[0] };
  if (/GNU GENERAL PUBLIC LICENSE/i.test(body)) return { has: true, name: "GPL", file: files[0] };
  return { has: true, name: "custom", file: files[0] };
}

/* ---------- render badge ---------- */
function badge({ label, value, color = C.accent, valueText = C.white, w = null }) {
  const lw = textW(label) + PAD * 2;
  const vw = Math.max(textW(value) + PAD * 2, w || 0);
  const total = lw + vw;
  const h = 22;
  const totalFixed = total + 2; // ruang border
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalFixed}" height="${h}" viewBox="0 0 ${totalFixed} ${h}" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <title>${esc(label)}: ${esc(value)}</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.valueBg}"/>
      <stop offset="100%" stop-color="${C.labelBg}"/>
    </linearGradient>
    <clipPath id="r"><rect x="0.5" y="0.5" width="${total}" height="${h - 1}" rx="5"/></clipPath>
  </defs>
  <g clip-path="url(#r)">
    <rect x="0.5" y="0.5" width="${lw}" height="${h - 1}" fill="${C.labelBg}"/>
    <rect x="${lw + 0.5}" y="0.5" width="${vw}" height="${h - 1}" fill="url(#g)"/>
    <rect x="${lw + 0.5}" y="0.5" width="1" height="${h - 1}" fill="${color}" fill-opacity="0.55"/>
  </g>
  <rect x="0.5" y="0.5" width="${total}" height="${h - 1}" rx="5" fill="none" stroke="${C.border}"/>
  <g font-family="'DejaVu Sans Mono',ui-monospace,'SF Mono',Consolas,monospace" font-size="11" font-weight="600">
    <text x="${lw / 2}" y="15" text-anchor="middle" fill="${C.label}">${esc(label)}</text>
    <text x="${lw + vw / 2}" y="15" text-anchor="middle" fill="${valueText}">${esc(value)}</text>
  </g>
</svg>
`;
}

/* ---------- gabung deretan badge jadi satu strip ---------- */
function strip(items) {
  const lw = (b) => textW(b.label) + PAD * 2;
  const vw = (b) => textW(b.value) + PAD * 2;
  const widths = items.map((b) => lw(b) + vw(b) + 2);
  const gap = 8;
  const W = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  const H = 22;
  let x = 0;
  let parts = [];
  const clips = [];
  items.forEach((b, i) => {
    const L = lw(b);
    const V = vw(b);
    const T = L + V;
    const cid = `c${i}`;
    clips.push(`    <clipPath id="${cid}"><rect x="0.5" y="0.5" width="${T}" height="${H - 1}" rx="5"/></clipPath>`);
    parts.push(`  <g transform="translate(${x} 0)">
    <g clip-path="url(#${cid})">
      <rect x="0.5" y="0.5" width="${L}" height="${H - 1}" fill="${C.labelBg}"/>
      <rect x="${L + 0.5}" y="0.5" width="${V}" height="${H - 1}" fill="${C.valueBg}"/>
      <rect x="${L + 0.5}" y="0.5" width="1" height="${H - 1}" fill="${b.color}" fill-opacity="0.55"/>
    </g>
    <rect x="0.5" y="0.5" width="${T}" height="${H - 1}" rx="5" fill="none" stroke="${C.border}"/>
    <g font-family="'DejaVu Sans Mono',ui-monospace,'SF Mono',Consolas,monospace" font-size="11" font-weight="600">
      <text x="${L / 2}" y="15" text-anchor="middle" fill="${C.label}">${esc(b.label)}</text>
      <text x="${L + V / 2}" y="15" text-anchor="middle" fill="${b.valueText || C.white}">${esc(b.value)}</text>
    </g>
  </g>`);
    x += widths[i] + gap;
  });
  const Wf = W + 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Wf}" height="${H}" viewBox="0 0 ${Wf} ${H}" role="img" aria-label="CodeClaw Pro badges">
  <title>CodeClaw Pro</title>
  <defs>
${clips.join("\n")}
  </defs>
${parts.join("\n")}
</svg>
`;
}

/* ---------- main ---------- */
(async () => {
  const pkg = readPkg();
  const tools = await countTools();
  const tests = runTests();
  const lic = detectLicense();
  const deps = countDeps(pkg);

  const nodeReq = String(pkg.engines?.node || "").replace(/^>=/, "") || "n/a";
  const items = [
    { file: "node.svg", label: "node", value: "≥ " + nodeReq, color: C.green, valueText: "#d7ffe9" },
    { file: "tools.svg", label: "tools", value: String(tools.n), color: C.accent, valueText: "#d9fbff" },
  ];

  if (tests && tests.pass > 0 && tests.fail === 0) {
    items.push({ file: "tests.svg", label: "tests", value: `${tests.pass} lulus`, color: C.green, valueText: "#d7ffe9" });
  } else if (tests) {
    items.push({ file: "tests.svg", label: "tests", value: `${tests.fail} gagal`, color: "#f87171", valueText: "#ffe0e0" });
  } else {
    items.push({ file: "tests.svg", label: "tests", value: "tidak dijalankan", color: C.amber, valueText: "#fff3d0" });
  }

  if (lic.has) {
    items.push({ file: "license.svg", label: "lisensi", value: lic.name, color: C.accent, valueText: "#d9fbff" });
  } else {
    items.push({ file: "license.svg", label: "lisensi", value: "belum ada", color: C.amber, valueText: "#fff3d0" });
  }

  items.push({ file: "version.svg", label: "versi", value: "v" + pkg.version, color: C.accent, valueText: "#d9fbff" });

  // Badge deps: HANYA klaim "0 required" kalau dependencies benar-benar kosong.
  if (deps.required === 0) {
    const val = deps.optional ? `0 wajib (+${deps.optional} opsional)` : "0 required";
    items.push({ file: "deps.svg", label: "deps", value: val, color: C.green, valueText: "#d7ffe9" });
  } else {
    items.push({
      file: "deps.svg",
      label: "deps",
      value: `${deps.required} required`,
      color: C.amber,
      valueText: "#fff3d0",
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const it of items) {
    fs.writeFileSync(path.join(OUT_DIR, it.file), badge(it), "utf8");
  }
  fs.writeFileSync(path.join(OUT_DIR, "all.svg"), strip(items), "utf8");

  // ringkasan ke stdout (dipakai untuk verifikasi)
  const report = {
    tools: tools.n,
    toolsSource: tools.src,
    tests: tests ? `${tests.pass} lulus / ${tests.fail} gagal dari ${tests.total}` : "tidak dijalankan",
    node: nodeReq,
    version: pkg.version,
    license: lic.has ? `${lic.name} (${lic.file})` : "TIDAK ADA FILE LICENSE",
    deps: {
      required: deps.required,
      optional: deps.optional,
      dev: deps.dev,
      requiredNames: deps.requiredNames,
      optionalNames: deps.optionalNames,
    },
    badges: items.map((i) => i.file),
  };
  console.log(JSON.stringify(report, null, 2));

  if (tools.n !== 30) console.error(`PERINGATAN: jumlah tool = ${tools.n}, perkirakan dokumentasi perlu diperbarui`);
  if (!lic.has) console.error("PERINGATAN: README mengklaim MIT tetapi file LICENSE tidak ada");

  /* ---------- guard anti-basi ---------- */
  // README harus benar-benar memasang badge deps, dan klaim "0 required"
  // tidak boleh bertahan kalau dependencies ternyata tidak kosong.
  const readmePath = path.join(ROOT, "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    if (!/assets\/badges\/deps\.svg/.test(readme)) {
      console.error("PERINGATAN: README belum memasang assets/badges/deps.svg");
    }
    const claimZero = /0\s+(?:[\w.]+\s+){0,3}(required|wajib)/i;
    if (deps.required > 0 && claimZero.test(readme)) {
      console.error(
        `GAGAL: README mengklaim "0 required" padahal dependencies berisi ${deps.required} paket: ${deps.requiredNames.join(", ")}`
      );
      process.exitCode = 1;
    }
  }
})();
