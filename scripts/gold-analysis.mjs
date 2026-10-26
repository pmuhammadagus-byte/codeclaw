#!/usr/bin/env node
// Analisa harian XAU/USD: RSI(14) + SMA(20/50) + berita → rekomendasi.
// ponytail: SMA50 dihitung dari 50 bar saja (sesuai outputsize=50), jadi
// nilainya hanya satu titik di bar terakhir. Naikkan ke 120 kalau butuh
// riwayat SMA50 yang bisa dibandingkan antar hari.

import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webSearch, webFetch } from "../lib/web.js";
import { TelegramAPI } from "../lib/telegram-api.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SYMBOL = "XAU/USD";
const TIMEOUT = 20_000;

const LOG_PATH = join(ROOT, "gold.log");
const LOG_MAX = 1024 * 1024; // 1 MB
const LOG_KEEP = 500; // baris terakhir yang dipertahankan

// Sumber yang dianggap otoritatif untuk emas & kebijakan Fed.
const TRUSTED = [
  "jpmorgan", "federalreserve.gov", "federalreserve", "reuters.com",
  "gold.org", "worldgoldcouncil", "bls.gov", "ecb.europa.eu",
  "newyorkfed.org", "stlouisfed.org",
];
const DEEP_READ_MAX = 2; // jumlah artikel yang dibaca penuh
const DEEP_READ_CHARS = 4000; // per artikel

// Kata kunci untuk menilai relevansi & memilih kalimat bersubstansi.
const GOLD_KEYWORDS = [
  "gold", "emas", "xau", "bullion", "fed", "fomc", "interest rate", "suku bunga",
  "inflation", "inflasi", "rate cut", "rate hike", "safe haven", "treasury yield",
  "central bank", "demand", "outlook", "forecast",
];

// Frasa navigasi/legal yang sering nyelip di hasil scrape — bukan substansi.
const BOILERPLATE = [
  "for release at", "press release", "all rights reserved", "privacy policy",
  "terms of use", "subscribe", "cookie", "sign up", "log in",
  "key takeaways", "read more", "share this", "follow us",
];

// Halaman tool/kalkulator/tabel — bukan artikel yang bisa menyumbang alasan.
const NON_ARTICLE = /predictor|calculator|converter|chart|ticker|glossary|library\/|categories\//i;



const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "n/a");
const pct = (a, b) => (b ? ((a - b) / b) * 100 : NaN);
const sign = (n) => (Number.isFinite(n) ? (n >= 0 ? "+" : "") + n.toFixed(2) : "n/a");

// ─────────────────────────── INDIKATOR ───────────────────────────

/** SMA sederhana. Butuh minimal `period` nilai. */
export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const win = values.slice(-period);
  return win.reduce((a, b) => a + b, 0) / period;
}

/** RSI Wilder(14). Mengembalikan null kalau data belum cukup. */
export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;

  // Smoothing Wilder untuk sisa bar.
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** ADX(14) Wilder. Mengembalikan null kalau data kurang. */
export function adx(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period * 2 + 1) return null;
  const trs = [], plusDM = [], minusDM = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close, ph = bars[i - 1].high, pl = bars[i - 1].low;
    const upMove = h - ph, downMove = pl - l;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Seed
  let tr = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let pDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let mDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  const dxs = [];
  for (let i = period; i < trs.length; i++) {
    tr = tr - tr / period + trs[i];
    pDM = pDM - pDM / period + plusDM[i];
    mDM = mDM - mDM / period + minusDM[i];
    const pDI = tr ? (pDM / tr) * 100 : 0;
    const mDI = tr ? (mDM / tr) * 100 : 0;
    const dx = (pDI + mDI) ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0;
    dxs.push(dx);
  }
  if (dxs.length < period) return null;
  let adxVal = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxs.length; i++) {
    adxVal = (adxVal * (period - 1) + dxs[i]) / period;
  }
  return adxVal;
}

/** RSI Divergence: bandingkan 2 swing terakhir harga vs RSI. */
export function rsiDivergence(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 5) return null;
  const closes = bars.map((b) => b.close);
  // Swing lows/highs sederhana: bar yang lebih rendah/tinggi dari 2 tetangga.
  const lows = [], highs = [];
  for (let i = 2; i < bars.length - 2; i++) {
    if (bars[i].low < bars[i - 1].low && bars[i].low < bars[i - 2].low &&
        bars[i].low < bars[i + 1].low && bars[i].low < bars[i + 2].low) lows.push(i);
    if (bars[i].high > bars[i - 1].high && bars[i].high > bars[i - 2].high &&
        bars[i].high > bars[i + 1].high && bars[i].high > bars[i + 2].high) highs.push(i);
  }
  if (lows.length < 2 && highs.length < 2) return null;
  const rsiVals = closes.map((_, i) => rsi(closes.slice(0, i + 1), period));
  let bull = false, bear = false;
  if (lows.length >= 2) {
    const a = lows[lows.length - 2], b = lows[lows.length - 1];
    if (bars[b].low < bars[a].low && rsiVals[b] > rsiVals[a]) bull = true;
  }
  if (highs.length >= 2) {
    const a = highs[highs.length - 2], b = highs[highs.length - 1];
    if (bars[b].high > bars[a].high && rsiVals[b] < rsiVals[a]) bear = true;
  }
  return { bullish: bull, bearish: bear };
}

/** Pivot Point klasik + Fibonacci Retracement dari 50 bar terakhir. */
export function pivotLevels(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  const cl = bars[bars.length - 1].close;
  const pp = (hi + lo + cl) / 3;
  const r1 = 2 * pp - lo, r2 = pp + (hi - lo);
  const s1 = 2 * pp - hi, s2 = pp - (hi - lo);
  const range = hi - lo;
  const fib = [0.382, 0.5, 0.618].map((f) => lo + range * f);
  return { pp, r1, r2, s1, s2, fib, hi, lo };
}
export function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Seed: rata-rata TR pertama.
  let val = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Smoothing Wilder untuk sisa.
  for (let i = period; i < trs.length; i++) {
    val = (val * (period - 1) + trs[i]) / period;
  }
  return val;
}

async function loadConfig() {
  const raw = await readFile(join(ROOT, "config.json"), "utf8");
  const cfg = JSON.parse(raw);
  const key = cfg?.twelvedata?.apiKey;
  if (!key) throw new Error("twelvedata.apiKey tidak ditemukan di config.json");
  const botToken = cfg?.channels?.telegram?.accounts?.default?.botToken ?? "";
  const chatId = cfg?.channels?.telegram?.accounts?.default?.chatId ?? "";
  return { twelveKey: key, exaKey: cfg?.web?.exaApiKey ?? "", botToken, chatId };
}

async function fetchGold(apiKey) {
  const url =
    "https://api.twelvedata.com/time_series" +
    `?symbol=${encodeURIComponent(SYMBOL)}` +
    "&interval=1day&outputsize=50&format=JSON" +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();

  if (data?.status === "error" || data?.code) {
    throw new Error(`Twelve Data: ${data.message || `code ${data.code}`}`);
  }
  if (!Array.isArray(data?.values) || data.values.length === 0) {
    throw new Error("Twelve Data: tidak ada data harga yang dikembalikan");
  }

  // API mengembalikan terbaru→terlama. Dibalik jadi kronologis.
  const bars = data.values
    .map((v) => ({
      date: v.datetime,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }))
    .filter((b) => Number.isFinite(b.close))
    .reverse();

  if (bars.length < 2) throw new Error("Data harga tidak cukup untuk dianalisa");
  return bars;
}

/**
 * Ambil satu seri harian dari FRED (CSV publik, tanpa API key).
 * FRED menandai hari libur dengan "." — dibuang.
 */
async function fetchFredSeries(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`FRED ${id} HTTP ${res.status}`);
  const rows = (await res.text())
    .trim()
    .split("\n")
    .slice(1) // buang header "observation_date,<ID>"
    .map((line) => line.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([date, v]) => ({ date, value: Number(v) }))
    .filter((r) => Number.isFinite(r.value));
  if (!rows.length) throw new Error(`FRED ${id}: tidak ada data valid`);
  return rows;
}

/**
 * Kekuatan dolar — proxy EUR/USD (komponen ~57% bobot DXY, arah hampir identik,
 * dan satu ticker saja). DXY asli tidak tersedia: plan Free tak punya indeks,
 * FRED DTWEXBGS lag ~7 hari, dan ticker "USDX" di Twelve Data ternyata ETF NASDAQ.
 * ponytail: EUR/USD naik = dolar melemah. Ganti ke DXY asli kalau plan di-upgrade.
 */
async function fetchUsd(apiKey) {
  const url =
    "https://api.twelvedata.com/time_series" +
    `?symbol=EUR/USD&interval=1day&outputsize=10&format=JSON` +
    `&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Twelve Data EUR/USD HTTP ${res.status}`);
  const data = await res.json();
  if (data?.status === "error" || data?.code) {
    throw new Error(`Twelve Data EUR/USD: ${data.message || `code ${data.code}`}`);
  }
  const rows = (data?.values ?? [])
    .map((v) => ({ date: v.datetime, value: Number(v.close) }))
    .filter((r) => Number.isFinite(r.value))
    .reverse();
  if (!rows.length) throw new Error("EUR/USD: tidak ada data valid");
  return rows;
}

/** Nilai terakhir + perubahan absolut & relatif terhadap N sesi sebelumnya. */
function lastAndChange(rows, lookback = 5) {
  const last = rows[rows.length - 1];
  const ref = rows[Math.max(0, rows.length - 1 - lookback)];
  return {
    value: last.value,
    date: last.date,
    changeAbs: last.value - ref.value, // untuk yield: poin persen (pp)
    changePct: ref.value ? (last.value / ref.value - 1) * 100 : 0, // untuk DXY: persen
    refDate: ref.date,
  };
}

/**
 * Makro: US10Y (FRED DGS10), USD proxy EUR/USD (Twelve Data), VIX (FRED VIXCLS).
 * Tiap seri independen — satu gagal tidak menggagalkan yang lain maupun analisa emas.
 */
async function fetchMacro(apiKey) {
  const [us10y, vix, usd, realYield] = await Promise.allSettled([
    fetchFredSeries("DGS10"),
    fetchFredSeries("VIXCLS"),
    fetchUsd(apiKey),
    fetchFredSeries("DFII10"),
  ]);

  const pick = (r, label) => {
    if (r.status === "fulfilled") return lastAndChange(r.value);
    return { value: null, date: null, changePct: 0, error: `${label}: ${r.reason?.message ?? r.reason}` };
  };

  return {
    us10y: pick(us10y, "US10Y"),
    usd: pick(usd, "EUR/USD"),
    vix: pick(vix, "VIX"),
    realYield: pick(realYield, "DFII10"),
  };
}

async function fetchNews(exaKey) {
  const queries = ["Gold price forecast", "Fed interest rate", "FOMC statement gold outlook"];
  const news = [];
  for (const q of queries) {
    try {
      const hits = await webSearch(q, 3, exaKey);
      for (const h of hits) news.push({ query: q, ...h });
    } catch (e) {
      news.push({ query: q, title: `[gagal: ${e.message}]`, url: "", snippet: "" });
    }
  }
  return news;
}

/**
 * Pilih 1-2 artikel paling relevan lalu baca isinya penuh.
 * Prioritas: domain otoritatif → baru skor kecocokan kata kunci.
 */
async function deepRead(news, exaKey) {
  const seen = new Set();

  const scored = news
    .filter((n) => n.url && !n.url.includes("[gagal") && !NON_ARTICLE.test(n.url) && !seen.has(n.url) && seen.add(n.url))
    .map((n) => {
      const hay = `${n.title} ${n.snippet}`.toLowerCase();
      const trusted = TRUSTED.some((d) => n.url.toLowerCase().includes(d)) ? 1 : 0;
      let s = 0;
      // Sinyal khas halaman tool: judul pendek + tidak ada kata "forecast/outlook".
      if (!/\b(forecast|outlook|predict|analysis|why|how|rate|fed|gold price)\b/i.test(n.title)) s -= 5;
      for (const kw of GOLD_KEYWORDS) if (hay.includes(kw)) s += 2;
      // Judul yang benar-benar tentang emas lebih relevan daripada sekadar suku bunga.
      if (/gold|emas|xau/i.test(n.title)) s += 3;
      return { ...n, trusted, relevance: s };
    })
    // Domain otoritatif menang mutlak; kata kunci hanya penentu di dalam kelompoknya.
    .sort((a, b) => b.trusted - a.trusted || b.relevance - a.relevance)
    .slice(0, DEEP_READ_MAX + 2); // ambil cadangan untuk kasus scrape gagal

  const out = [];
  for (const art of scored) {
    if (out.filter((x) => x.text).length >= DEEP_READ_MAX) break; // target terpenuhi
    try {
      const text = await webFetch(art.url, { maxBytes: DEEP_READ_CHARS, exaApiKey: exaKey });
      const clean = sanitize(text);
      if (clean.length < 200) throw new Error("isi terlalu pendek / terblokir");
      const facts = extractFacts(clean);
      // Halaman resmi berisi tabel rate sering lolos scrape tapi tanpa substansi.
      if (!facts.length) throw new Error("tidak ada kalimat bersubstansi");
      out.push({ ...art, text: clean, facts });
    } catch (e) {
      out.push({ ...art, text: "", facts: [], error: e.message });
    }
  }
  return out;
}

/** Bersihkan teks artikel: buang markdown/boilerplate, jaga kalimat tetap utuh. */
function sanitize(raw) {
  return String(raw)
    .replace(/\r/g, " ")
    .replace(/#{1,6}\s*/g, "") // header markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [teks](url) → teks
    .replace(/\*\*/g, "")
    .replace(/(^|\s)[-*•]\s+/g, "$1") // bullet list
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Terjemahkan isi artikel jadi sinyal untuk emas.
 * Dovish (pemotongan suku bunga, pelemahan dolar) → bullish emas.
 * Hawkish (kenaikan suku bunga, yield/dolar menguat) → bearish emas.
 */
function newsSignal(articles) {
  const DOVISH = ["rate cut", "cut rates", "easing", "dovish", "lower rates", "weak jobs", "recession", "safe haven", "geopolitical"];
  const HAWKISH = ["rate hike", "hike", "hawkish", "higher for longer", "strong dollar", "yields rise", "tightening"];

  let raw = 0;
  const notes = [];
  for (const art of articles.filter((a) => a.facts.length)) {
    const text = art.facts.join(" ").toLowerCase();
    const d = DOVISH.filter((k) => text.includes(k)).length;
    const h = HAWKISH.filter((k) => text.includes(k)).length;
    if (d > h) notes.push("nada dovish (mendukung emas)");
    else if (h > d) notes.push("nada hawkish (menekan emas)");
    else if (d || h) notes.push("nada campuran");
    raw += Math.sign(d - h);
  }

  // Dibatasi ±1: berita hanya penentu arah, bukan penggeser utama skor teknikal.
  const score = Math.max(-1, Math.min(1, Math.sign(raw)));
  return { score, notes: [...new Set(notes)] };
}

/** Ambil kalimat yang memuat angka/kebijakan — tidak mengarang, hanya memilih. */
function extractFacts(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 60 && s.length < 300);
  const scored = sentences
    .map((s) => {
      const l = s.toLowerCase();
      if (BOILERPLATE.some((b) => l.includes(b))) return { s, s2: 0 };
      let s2 = 0;
      for (const kw of GOLD_KEYWORDS) if (l.includes(kw)) s2 += 2;
      if (/\d+(\.\d+)?%|\$\d|\b\d{4}\b/.test(s)) s2 += 2; // ada angka konkret
      if (/\b(forecast|expect|target|outlook|project|estimate|predict)\b/i.test(s)) s2 += 2;
      return { s, s2 };
    })
    .filter((x) => x.s2 >= 6)
    .sort((a, b) => b.s2 - a.s2)
    .slice(0, 3)
    .map((x) => x.s.trim());
  return scored;
}


// ─────────────────────────── ANALISA ───────────────────────────

function analyze(bars, articles = [], macro = null) {
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  // ponytail: provider kirim bar Sabtu/Minggu yg stale (close nyaris = Jumat),
  // jadi perubahan harian dibandingkan ke sesi bursa terakhir, bukan ke bar weekend.
  const prev = bars
    .slice(0, -1)
    .reverse()
    .find((b) => ![0, 6].includes(new Date(`${b.date}T00:00:00Z`).getUTCDay())) ?? bars[bars.length - 2];

  const rsiVal = rsi(closes, 14);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const changePct = pct(last.close, prev.close);
  const hi50 = Math.max(...bars.map((b) => b.high));
  const lo50 = Math.min(...bars.map((b) => b.low));

  // Skor sederhana: + bullish, − bearish. Netral kalau impas.
  let score = 0;
  const reasons = [];

  if (Number.isFinite(rsiVal)) {
    if (rsiVal < 30) { score += 2; reasons.push("RSI oversold"); }
    else if (rsiVal > 70) { score -= 2; reasons.push("RSI overbought"); }
    else if (rsiVal < 45) { score += 1; reasons.push("RSI condong lemah"); }
    else if (rsiVal > 60) { score -= 1; reasons.push("RSI condong panas"); }
  }
  if (Number.isFinite(sma20)) {
    if (last.close > sma20) { score += 1; reasons.push("harga di atas SMA20"); }
    else { score -= 1; reasons.push("harga di bawah SMA20"); }
  }
  if (Number.isFinite(sma20) && Number.isFinite(sma50)) {
    if (sma20 > sma50) { score += 1; reasons.push("SMA20 > SMA50 (tren naik)"); }
    else { score -= 1; reasons.push("SMA20 < SMA50 (tren turun)"); }
  }

  const news = newsSignal(articles);
  if (news.score > 0) { score += news.score; reasons.push("berita cenderung dovish"); }
  else if (news.score < 0) { score -= 1; reasons.push("berita cenderung hawkish"); }

  // ── RSI DIVERGENCE ─────────────────────────────────────
  const div = rsiDivergence(bars, 14);
  if (div?.bullish) { score += 1; reasons.push("Bullish RSI divergence terdeteksi"); }
  if (div?.bearish) { score -= 1; reasons.push("Bearish RSI divergence terdeteksi"); }

  // ── ADX REGIM ──────────────────────────────────────────
  // < 20 = sideways (kurangi bobot sinyal RSI), > 25 = trending (beri bobot)
  const adxVal = adx(bars, 14);
  let adxRegime = "unknown";
  if (adxVal != null) {
    if (adxVal < 20) {
      adxRegime = "sideways";
      if (rsiVal < 30) { score -= 0; /* indikator rawan false signal - biarkan, namun catat */ }
      reasons.push(`ADX ${adxVal.toFixed(1)} < 20 (sideways, perhitungkan RSI dengan hati-hati)`);
    } else if (adxVal > 25) {
      adxRegime = "trending";
      if (rsiVal < 30) { score += 1; reasons.push(`ADX ${adxVal.toFixed(1)} > 25 (trending, konfirmasi oversold lebih kuat)`); }
      else if (rsiVal > 70) { score -= 1; reasons.push(`ADX ${adxVal.toFixed(1)} > 25 (trending, konfirmasi overbought lebih kuat)`); }
    }
  }

  // ── S/R OTOMATIS ───────────────────────────────────────
  const piv = pivotLevels(bars.slice(-50));
  if (piv) {
    const levelsAll = [piv.s2, piv.s1, piv.pp, piv.r1, piv.r2, ...piv.fib];
    let closest = null, minDist = Infinity;
    for (const lv of levelsAll) {
      if (lv == null) continue;
      const d = Math.abs(lv - last.close);
      if (d < minDist) { minDist = d; closest = lv; }
    }
    if (closest != null) {
      reasons.push(`Level terdekat: ${closest.toFixed(2)} (S/R/Fib)`);
    }
  }

  // ── MAKRO ───────────────────────────────────────────────
  // Dibatasi ±2 total agar makro mengoreksi, bukan mendominasi, sinyal teknikal.
  // Ambang: yield ±10bps dan DXY ±0,5% per 5 sesi, VIX level 20/28.
  let macroScore = 0;
  if (macro) {
    const { us10y, usd, vix } = macro;

    if (us10y?.value != null) {
      const pp = us10y.changeAbs; // perubahan yield dalam poin persen
      if (pp >= 0.10) { macroScore -= 1; reasons.push(`US10Y +${pp.toFixed(2)}pp (bearish)`); }
      else if (pp <= -0.10) { macroScore += 1; reasons.push(`US10Y ${pp.toFixed(2)}pp (bullish)`); }
    }

    // Real yield (DFII10): naik → biaya opportunity emas naik → bearish; turun → bullish
    if (macro.realYield?.value != null) {
      const pp = macro.realYield.changeAbs;
      if (pp >= 0.10) { macroScore -= 1; reasons.push(`Real yield (DFII10) +${pp.toFixed(2)}pp (bearish)`); }
      else if (pp <= -0.10) { macroScore += 1; reasons.push(`Real yield (DFII10) ${pp.toFixed(2)}pp (bullish)`); }
    }

    // EUR/USD naik = dolar melemah = bullish emas (arah dibalik dari DXY).
    if (usd?.value != null) {
      const p = usd.changePct;
      if (p >= 0.5) { macroScore += 1; reasons.push(`dolar melemah ${p.toFixed(2)}% (bullish)`); }
      else if (p <= -0.5) { macroScore -= 1; reasons.push(`dolar menguat ${p.toFixed(2)}% (bearish)`); }
    }

    if (vix?.value != null) {
      if (vix.value >= 28) { macroScore += 1; reasons.push(`VIX ${vix.value.toFixed(1)} (panik, bullish)`); }
      else if (vix.value <= 15) { macroScore -= 1; reasons.push(`VIX ${vix.value.toFixed(1)} (tenang, bearish)`); }
    }

    macroScore = Math.max(-2, Math.min(2, macroScore));
    score += macroScore;
  }

  const reco = score >= 2 ? "BUY" : score <= -2 ? "SELL" : "WAIT";

  const atrVal = atr(bars, 14);
  const slDist = Number.isFinite(atrVal) ? atrVal * 1.5 : null;
  const levels = reco !== "WAIT" && slDist != null
    ? {
        entry: last.close,
        sl: reco === "BUY" ? last.close - slDist : last.close + slDist,
        tp1: reco === "BUY" ? last.close + slDist : last.close - slDist,
        tp2: reco === "BUY" ? last.close + slDist * 2 : last.close - slDist * 2,
        atr: atrVal,
      }
    : null;

  return { last, rsiVal, sma20, sma50, changePct, hi50, lo50, score, reasons, reco, levels, divergence: div, adx: adxVal, adxRegime, pivots: piv, newsSignal: news, macro, macroScore };
}

function buildAnalysis(a, news, articles = []) {
  const p1 =
    `${SYMBOL} ditutup di ${f2(a.last.close)} pada ${a.last.date} ` +
    `(${sign(a.changePct)}% vs hari sebelumnya). Dalam 50 sesi terakhir rentangnya ` +
    `${f2(a.lo50)}–${f2(a.hi50)}, dan harga sekarang berada di ` +
    `${pct(a.last.close, a.lo50) > 50 ? "separuh atas" : "separuh bawah"} rentang itu. ` +
    (a.sma20 && a.sma50
      ? `SMA20 ${f2(a.sma20)} ${a.sma20 > a.sma50 ? "berada di atas" : "berada di bawah"} SMA50 ${f2(a.sma50)}, ` +
        `menandakan struktur tren ${a.sma20 > a.sma50 ? "naik" : "turun"} jangka menengah.`
      : `SMA50 belum bisa dihitung dari ${50} bar yang tersedia.`);

  const rsiText = !Number.isFinite(a.rsiVal)
    ? "RSI tidak tersedia."
    : a.rsiVal < 30
      ? `RSI berada di ${a.rsiVal.toFixed(1)} — wilayah oversold, secara statistik rawan pantulan naik.`
      : a.rsiVal > 70
        ? `RSI berada di ${a.rsiVal.toFixed(1)} — wilayah overbought, risiko koreksi meningkat.`
        : `RSI berada di ${a.rsiVal.toFixed(1)} — zona netral, belum ada tekanan jenuh beli maupun jenuh jual.`;

  const p2 = rsiText;

  // P3: isi artikel yang benar-benar dibaca, bukan sekadar judul.
  const ok = articles.filter((x) => x.facts?.length);
  let p3;
  if (ok.length) {
    const lines = ok.map((x, i) => {
      const host = x.url.replace(/^https?:\/\//, "").split("/")[0];
      return `(${i + 1}) ${host} — "${x.title.slice(0, 90)}": ` + x.facts.join(" ");
    });
    p3 =
      `Pembacaan langsung terhadap ${ok.length} artikel paling relevan memberi konteks berikut. ` +
      lines.join(" ") +
      ` Rujukan ini dipakai untuk menimbang apakah pergerakan teknikal di atas didukung ` +
      `atau dibantah oleh ekspektasi pasar.`;
  } else {
    const titles = news.filter((n) => n.url).slice(0, 3).map((n) => n.title);
    p3 = titles.length
      ? `Dari sisi berita, sorotan pasar terbaru antara lain: ` +
        titles.map((t, i) => `(${i + 1}) ${t}`).join("; ") +
        `. Isi lengkap artikel tidak berhasil dibaca pada run ini, sehingga bobot analisa ` +
        `bertumpu pada indikator teknikal dan judul berita saja.`
      : `Tidak ada berita yang berhasil diambil pada run ini, sehingga analisa sepenuhnya ` +
        `bersandar pada indikator teknikal di atas.`;
  }

  return [p1, p2, p3];
}

// ─────────────────────────── OUTPUT ───────────────────────────

function render(a, news, paragraphs, bars) {
  const L = [];
  L.push("");
  L.push("═".repeat(64));
  L.push(`  ANALISA HARIAN ${SYMBOL}`);
  L.push(`  ${new Date().toISOString()}`);
  L.push("═".repeat(64));
  L.push("");
  L.push(`  Harga terakhir : ${f2(a.last.close)}  (${sign(a.changePct)}%)`);
  L.push(`  Bar terakhir   : ${a.last.date}`);
  L.push(`  Rentang 50h    : ${f2(a.lo50)} – ${f2(a.hi50)}`);
  L.push(`  Bar terpakai   : ${bars.length}`);
  L.push("");
  L.push("  ── INDIKATOR ──────────────────────────────────");
  L.push(`  RSI(14) : ${Number.isFinite(a.rsiVal) ? a.rsiVal.toFixed(2) : "n/a"}`);
  L.push(`  SMA(20) : ${f2(a.sma20)}`);
  L.push(`  SMA(50) : ${f2(a.sma50)}`);
  if (Number.isFinite(a.adx)) L.push(`  ADX(14) : ${a.adx.toFixed(1)} (${a.adxRegime || "n/a"})`);
  if (a.divergence) {
    const d = a.divergence;
    if (d.bullish || d.bearish) L.push(`  Div RSI : ${d.bullish ? "BULLISH" : ""}${d.bullish && d.bearish ? "/" : ""}${d.bearish ? "BEARISH" : ""}`);
    else L.push("  Div RSI : Tidak ada");
  }
  if (a.pivots) {
    const p = a.pivots, c = a.last.close;
    const arr = [{k:"S2",v:p.s2},{k:"S1",v:p.s1},{k:"PP",v:p.pp},{k:"R1",v:p.r1},{k:"R2",v:p.r2},{k:"Fib38.2",v:p.fib?.[0]},{k:"Fib50",v:p.fib?.[1]},{k:"Fib61.8",v:p.fib?.[2]}];
    let best=null,md=Infinity;
    for (const x of arr) if (x.v!=null){const d=Math.abs(x.v-c);if(d<md){md=d;best=x;}}
    if (best) L.push(`  S/R/Fib : Terdekat ${best.k} ${f2(best.v)} (Δ${f2(md)})`);
  }
  if (a.macro) {
    const m = a.macro;
    const fmt = (x, d = 2, suf = "") => (x?.value == null ? "n/a" : `${x.value.toFixed(d)}${suf} (${x.date})`);
    L.push("");
    L.push("  ── MAKRO ──────────────────────────────────────");
    L.push(`  US10Y : ${fmt(m.us10y, 2, "%")}${m.us10y?.value != null ? ` | ${sign(m.us10y.changeAbs)} pp` : ""}`);
    L.push(`  RealY : ${fmt(m.realYield, 2, "%")}${m.realYield?.value != null ? ` | ${sign(m.realYield.changeAbs)} pp` : ""}`);
    L.push(`  USD   : EUR/USD ${fmt(m.usd, 4)}${m.usd?.value != null ? ` | ${sign(m.usd.changePct)}% (dolar)` : ""}`);
    L.push(`  VIX   : ${fmt(m.vix)}`);
    for (const k of ["us10y", "usd", "vix"]) {
      if (m[k]?.error) L.push(`  (${k} gagal: ${m[k].error})`);
    }
    L.push(`  Skor makro: ${sign(a.macroScore)}`);
  }
  L.push(`  Sinyal  : ${a.reasons.join(", ") || "netral"}`);
  L.push(`  Skor    : ${a.score}`);
  L.push("");
  L.push("  ── BERITA ─────────────────────────────────────");
  if (!news.length) L.push("  (kosong)");
  for (const n of news.slice(0, 6)) {
    L.push(`  • [${n.query}] ${String(n.title).slice(0, 64)}`);
    if (n.url) L.push(`    ${n.url.slice(0, 76)}`);
  }
  L.push("");
  L.push("  ── ANALISA ────────────────────────────────────");
  paragraphs.forEach((p, i) => {
    L.push(`  ${i + 1}. ${p}`);
    L.push("");
  });
  L.push("═".repeat(64));
  L.push(`  REKOMENDASI: ${a.reco}`);
  if (a.levels) {
    L.push(`  Entry: ${f2(a.levels.entry)} | SL: ${f2(a.levels.sl)} | TP1: ${f2(a.levels.tp1)} | TP2: ${f2(a.levels.tp2)} | ATR(14): ${f2(a.levels.atr)}`);
  }
  L.push("═".repeat(64));
  L.push("");
  return L.join("\n");
}

// ─────────────────────────── LOG ROTATE ───────────────────────────

/** Potong gold.log jadi 500 baris terakhir kalau sudah lewat 1 MB. */
async function rotateLog() {
  try {
    const { size } = await stat(LOG_PATH);
    if (size <= LOG_MAX) return null;
    const lines = (await readFile(LOG_PATH, "utf8")).split("\n");
    const kept = lines.slice(-LOG_KEEP).join("\n");
    await writeFile(LOG_PATH, kept);
    return { before: size, after: Buffer.byteLength(kept) };
  } catch (e) {
    if (e.code === "ENOENT") return null; // belum pernah nulis log
    throw e;
  }
}

// ─────────────────────────── TELEGRAM ───────────────────────────

// parse_mode=HTML, jadi karakter khusus wajib di-escape.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildMessage(a, paragraphs) {
  const icon = a.reco === "BUY" ? "🟢" : a.reco === "SELL" ? "🔴" : "⚪️";
  const rsiTxt = Number.isFinite(a.rsiVal) ? a.rsiVal.toFixed(2) : "n/a";

  const L = [
    `<b>${esc(SYMBOL)} — Analisa Harian</b>`,
    `<i>${esc(a.last.date)}</i>`,
    "",
    `Harga: <b>${f2(a.last.close)}</b> (${esc(sign(a.changePct))}%)`,
    `RSI(14): <b>${rsiTxt}</b>`,
    `SMA(20): ${f2(a.sma20)} | SMA(50): ${f2(a.sma50)}`,
    `Rentang 50h: ${f2(a.lo50)} – ${f2(a.hi50)}`,
    "",
  ];
  for (const p of paragraphs) L.push(esc(p), "");
  L.push(`${icon} <b>Rekomendasi: ${a.reco}</b>`);
  L.push(`<i>Skor ${a.score} · ${esc(a.reasons.join(", ") || "netral")}</i>`);

  const msg = L.join("\n");
  // Batas keras Telegram 4096 karakter.
  return msg.length > 4000 ? msg.slice(0, 3950) + "\n…" : msg;
}

async function sendTelegram(botToken, text, chatId) {
  if (!botToken) return { sent: false, reason: "botToken kosong di config.json" };
  if (!chatId) return { sent: false, reason: "chatId kosong di config.json (panel → [2] Telegram → [4])" };
  const res = await new TelegramAPI(botToken).sendMessage(chatId, text);
  return { sent: true, messageId: res?.message_id };
}

// ─────────────────────────── MAIN ───────────────────────────

async function main({ notify = true } = {}) {
  const rotated = await rotateLog();
  if (rotated) {
    console.error(
      `[log] dirotasi: ${(rotated.before / 1024).toFixed(0)}KB → ` +
      `${(rotated.after / 1024).toFixed(0)}KB (${LOG_KEEP} baris terakhir)`
    );
  }

  const { twelveKey, exaKey, botToken, chatId } = await loadConfig();
  const [bars, news, macro] = await Promise.all([
    fetchGold(twelveKey),
    fetchNews(exaKey),
    fetchMacro(twelveKey).catch(() => null),
  ]);

  const articles = await deepRead(news, exaKey);
  const a = analyze(bars, articles, macro);
  const paragraphs = buildAnalysis(a, news, articles);
  console.log(render(a, news, paragraphs, bars));
  const good = articles.filter((x) => x.facts.length);
  console.log(
    `  ARTIKEL DIBACA: ${good.length}/${articles.length}\n` +
    (articles.length
      ? articles.map((x) => `    ${x.facts.length ? "✓" : "✗"} [${x.trusted ? "resmi" : "umum"}] ${x.url.replace(/^https?:\/\//, "").split("/")[0]}` +
          (x.error ? ` — ${x.error}` : ` — ${x.facts.length} fakta`)).join("\n")
      : "    (tidak ada kandidat)") + "\n"
  );

  let tg = { sent: false, reason: "dimatikan (--no-telegram)" };
  if (notify) {
    try {
      tg = await sendTelegram(botToken, buildMessage(a, paragraphs), chatId);
    } catch (e) {
      tg = { sent: false, reason: e.message };
      console.error(`[telegram] gagal: ${e.message}`);
    }
  }
  console.log(
    `[telegram] ${tg.sent ? `terkirim (msg ${tg.messageId})` : `tidak terkirim — ${tg.reason}`}\n`
  );

  return { ...a, bars: bars.length, news: news.length, articles: articles.length, telegram: tg };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const notify = !process.argv.includes("--no-telegram");
  main({ notify }).catch((e) => {
    // Data/analisa gagal → tetap exit 1. Pengiriman TG gagal tidak menggagalkan run.
    console.error(`\n✗ GAGAL: ${e.message}\n`);
    process.exit(1);
  });
}

export { main, analyze, fetchGold, fetchMacro, fetchUsd, fetchFredSeries, loadConfig, rotateLog, buildMessage, sendTelegram, deepRead, extractFacts, newsSignal, sanitize };

