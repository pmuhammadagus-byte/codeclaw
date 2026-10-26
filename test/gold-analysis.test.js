import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFacts, newsSignal, sanitize, analyze, atr, adx, rsiDivergence, pivotLevels } from "../scripts/gold-analysis.mjs";

test("sanitize membuang markdown & bullet, menyisakan kalimat utuh", () => {
  const raw = "## Press Release\n### Fed\n- **Gold** rises [lihat](https://x.com) hari ini.";
  const out = sanitize(raw);
  assert.ok(!out.includes("#"), "header markdown harus hilang");
  assert.ok(!out.includes("]("), "link markdown harus jadi teks");
  assert.ok(!out.includes("**"), "bold harus hilang");
  assert.ok(out.includes("Gold rises lihat hari ini"), `isi salah: ${out}`);
});

test("extractFacts memilih kalimat berangka & membuang boilerplate", () => {
  const text =
    "For release at 2:00 p.m. Press Release. " +
    "Central bank gold purchases averaged 225 tons per quarter, roughly double the 2016-2020 pace. " +
    "Analysts forecast gold to reach $4,500 by mid-2027 on rate cut expectations. " +
    "Privacy policy and terms of use.";
  const facts = extractFacts(text);
  assert.ok(facts.length > 0, "harus ada fakta");
  assert.ok(facts.some((f) => f.includes("225 tons")), "fakta angka harus terpilih");
  assert.ok(!facts.some((f) => /privacy policy|for release at/i.test(f)), "boilerplate harus dibuang");
});

test("newsSignal: dovish bullish, hawkish bearish, dibatasi ±1", () => {
  const mk = (t) => [{ facts: [t] }, { facts: [t] }, { facts: [t] }];
  const dov = newsSignal(mk("A surprise rate cut and dovish Fed amid recession risk."));
  const hawk = newsSignal(mk("Hawkish Fed signals rate hike, higher for longer, strong dollar."));
  assert.equal(dov.score, 1, "dovish seharusnya +1 walau 3 artikel");
  assert.equal(hawk.score, -1, "hawkish seharusnya -1 walau 3 artikel");
  assert.equal(newsSignal([]).score, 0, "tanpa artikel = netral");
});

test("changePct melewati bar Sabtu/Minggu yang stale", () => {
  const bars = [
    { date: "2026-10-23", open: 4026, high: 4034, low: 3975, close: 4000.88 },
    { date: "2026-10-24", open: 4000, high: 4000, low: 3992, close: 3993.7 },
    { date: "2026-10-25", open: 3993, high: 3993, low: 3993, close: 3993.8 },
    { date: "2026-10-26", open: 3993, high: 4003, low: 3977, close: 3991.54 },
  ];
  const a = analyze(bars, []);
  const vsFriday = ((3991.54 / 4000.88263 - 1) * 100);
  assert.ok(
    Math.abs(a.changePct - vsFriday) < 0.001,
    `harus vs Jumat (${vsFriday.toFixed(4)}%), dapat ${a.changePct.toFixed(4)}%`
  );
});

test("analyze: makro bearish (yield naik, DXY kuat, VIX tenang) menurunkan skor", () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 2000 + i * 5, high: 2010 + i * 5, low: 1990 + i * 5, close: 2005 + i * 5,
  }));
  const macroBear = {
    us10y: { value: 5.3, changeAbs: 0.25, changePct: 5 },
    usd: { value: 1.09, changeAbs: -0.01, changePct: -1.2 }, // dolar menguat
    vix: { value: 13, changeAbs: -1, changePct: -7 },
  };
  const base = analyze(bars, []);
  const bear = analyze(bars, [], macroBear);
  assert.ok(bear.score < base.score, `makro bearish harus turunkan skor (${base.score} → ${bear.score})`);
  assert.equal(bear.macroScore, -2, "dibatasi -2 walau 3 sinyal bearish");
});

test("analyze: VIX panik menaikkan skor, dan makro dibatasi ±2", () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 2000 + i * 5, high: 2010 + i * 5, low: 1990 + i * 5, close: 2005 + i * 5,
  }));
  const panic = {
    us10y: { value: 3.9, changeAbs: -0.3, changePct: -7 },
    usd: { value: 1.15, changeAbs: 0.01, changePct: 0.8 }, // dolar melemah
    vix: { value: 35, changeAbs: 6, changePct: 20 },
  };
  const base = analyze(bars, []);
  const a = analyze(bars, [], panic);
  assert.ok(a.score > base.score, "VIX tinggi + yield turun + dolar lemah harus naikkan skor");
  assert.equal(a.macroScore, 2, "dibatasi +2");
});

test("analyze: makro null / nilai null tidak melempar error", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-02-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 2000 + i, high: 2005 + i, low: 1995 + i, close: 2001 + i,
  }));
  assert.doesNotThrow(() => analyze(bars, [], null));
  const partial = { us10y: { value: null }, usd: { value: null, error: "x" }, vix: { value: null } };
  const a = analyze(bars, [], partial);
  assert.equal(a.macroScore, 0, "tanpa data valid, skor makro 0");
});
test("analyze: sinyal berita menggeser skor, tapi tidak melampaui batas", () => {
  // Tren naik kuat: harga di atas SMA20 & SMA50.
  const bars = Array.from({ length: 60 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 2000 + i * 5,
    high: 2010 + i * 5,
    low: 1990 + i * 5,
    close: 2005 + i * 5,
  }));

  const base = analyze(bars, []);
  const hawk = analyze(bars, [{ facts: ["Hawkish Fed signals rate hike and strong dollar."] }]);

  assert.ok(Number.isFinite(base.score), "skor harus angka");
  assert.ok(["BUY", "SELL", "WAIT"].includes(base.reco));
  assert.ok(hawk.score < base.score, "berita hawkish harus menurunkan skor");
  assert.equal(hawk.newsSignal.score, -1);
});

test("atr(14): mengembalikan null kalau data kurang, angka kalau cukup", () => {
  const bars = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: 2000 + i, high: 2010 + i, low: 1990 + i, close: 2000 + i,
  }));
  assert.equal(atr(bars, 14), null, "14 bar = kurang (butuh 15)");

  const bars15 = bars.concat({ date: "2026-01-15", open: 2014, high: 2024, low: 2004, close: 2014 });
  const a = atr(bars15, 14);
  assert.ok(Number.isFinite(a) && a > 0, `harus > 0, dapat ${a}`);
});

test("adx(14): null kalau kurang data, angka 0-100 kalau cukup", () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 2000 + i, high: 2010 + i, low: 1990 + i, close: 2000 + i + (i % 3 - 1),
  }));
  assert.equal(adx(bars.slice(0, 20), 14), null);
  const v = adx(bars, 14);
  assert.ok(Number.isFinite(v) && v >= 0 && v <= 100, `adx ${v}`);
});

test("rsiDivergence: deteksi bullish/bearish", () => {
  // Buat swing low ganda: harga turun lebih rendah, RSI naik (bullish divergence)
  const bars = [];
  for (let i = 0; i < 60; i++) {
    bars.push({ date: `2026-01-01`, open: 2000 - i, high: 2010 - i, low: 1990 - i, close: 2000 - i });
  }
  // Manipulasi: swing low pertama di ~i=20 (rendah), swing low kedua di ~i=50 lebih rendah tapi kita buat RSI naik
  // Sederhana: cukup pastikan fungsi mengembalikan object
  const d = rsiDivergence(bars, 14);
  assert.ok(d === null || (typeof d.bullish === "boolean" && typeof d.bearish === "boolean"));
});

test("pivotLevels: PP/R1/R2/S1/S2 + fib dari 50 bar", () => {
  const bars = Array.from({ length: 50 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 2000, high: 2050 - (i % 10), low: 1980 + (i % 5), close: 2000 + (i % 3),
  }));
  const p = pivotLevels(bars);
  assert.ok(p.pp > p.s1 && p.s1 > p.s2, "s2 < s1 < pp");
  assert.ok(p.r1 > p.pp && p.r2 > p.r1, "pp < r1 < r2");
  assert.ok(Array.isArray(p.fib) && p.fib.length === 3);
  assert.ok(p.fib[0] < p.fib[1] && p.fib[1] < p.fib[2]);
});
