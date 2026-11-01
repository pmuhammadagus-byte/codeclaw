#!/usr/bin/env node
// Pattern detection v2 — dengan 3 filter:
//   1. ATR gate: skip pattern kalau ATR < $3 (kompresi)
//   2. Near-price: S/R hanya dalam ±3 ATR dari harga
//   3. Recency: pattern hanya dari 10 candle terakhir

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, "..", "config.json"), "utf8"));
const KEY = cfg?.twelvedata?.apiKey;
if (!KEY) { console.error("❌ twelvedata apiKey kosong"); process.exit(1); }

const ATR_MIN = 3;          // min ATR $ untuk pattern detection
const NEAR_ATR_MULT = 3;    // jarak max S/R dari harga (dalam ATR)
const RECENT_WINDOW = 10;   // pattern hanya dari N candle terakhir

async function fetchOhlc(interval, size) {
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${size}&apikey=${KEY}`;
  const j = await (await fetch(url)).json();
  if (!j.values) throw new Error(j.message || j.code || "empty");
  return j.values.slice().reverse().map(v => ({
    t: v.datetime, o: +v.open, h: +v.high, l: +v.low, c: +v.close,
  }));
}

const body = c => Math.abs(c.c - c.o);
const range = c => c.h - c.l;
const upperWick = c => c.h - Math.max(c.c, c.o);
const lowerWick = c => Math.min(c.c, c.o) - c.l;
const isBull = c => c.c > c.o;
const isBear = c => c.c < c.o;

function calcAtr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    ));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// === PATTERN DETECTORS ===
const detectDoji = c => range(c) > 0 && body(c) / range(c) < 0.1;
const detectHammer = c => {
  const b = body(c), lw = lowerWick(c), uw = upperWick(c), r = range(c);
  return r > 0 && lw >= 2 * b && uw <= b * 0.3 && b / r < 0.4;
};
const detectShootingStar = c => {
  const b = body(c), lw = lowerWick(c), uw = upperWick(c), r = range(c);
  return r > 0 && uw >= 2 * b && lw <= b * 0.3 && b / r < 0.4;
};
const detectMarubozu = c => range(c) > 0 && body(c) / range(c) > 0.9;

function detectEngulfing(prev, curr) {
  if (isBull(prev) && isBear(curr)) return curr.o >= prev.c && curr.c <= prev.o && body(curr) > body(prev) * 1.2;
  if (isBear(prev) && isBull(curr)) return curr.o <= prev.c && curr.c >= prev.o && body(curr) > body(prev) * 1.2;
  return false;
}

function detectStar(c1, c2, c3) {
  if (isBear(c1) && body(c1) > range(c1) * 0.6 && body(c2) < range(c1) * 0.3 &&
      isBull(c3) && body(c3) > range(c3) * 0.6 && c3.c > (c1.o + c1.c) / 2) return "Morning Star";
  if (isBull(c1) && body(c1) > range(c1) * 0.6 && body(c2) < range(c1) * 0.3 &&
      isBear(c3) && body(c3) > range(c3) * 0.6 && c3.c < (c1.o + c1.c) / 2) return "Evening Star";
  return null;
}

function detectAll(candles) {
  const patterns = [];
  const start = Math.max(2, candles.length - RECENT_WINDOW);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i], p = candles[i-1], p2 = candles[i-2];
    const where = c.t.slice(5, 16) + " @ $" + c.c.toFixed(2);
    if (detectDoji(c))         patterns.push({ t: "Doji", at: where, w: 1 });
    if (detectHammer(c))       patterns.push({ t: "Hammer", at: where, w: 3 });
    if (detectShootingStar(c)) patterns.push({ t: "Shooting Star", at: where, w: 3 });
    if (detectMarubozu(c))     patterns.push({ t: (isBull(c) ? "Bullish" : "Bearish") + " Marubozu", at: where, w: 3 });
    if (detectEngulfing(p, c)) patterns.push({ t: (isBull(c) ? "Bullish" : "Bearish") + " Engulfing", at: where, w: 4 });
    const star = detectStar(p2, p, c);
    if (star) patterns.push({ t: star, at: where, w: 5 });
  }
  // Sort by importance (w desc), ambil max 5
  return patterns.sort((a, b) => b.w - a.w).slice(0, 5);
}

// === S/R DETECTION ===
function findSwings(candles, window = 3) {
  const highs = [], lows = [];
  for (let i = window; i < candles.length - window; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= window; j++) {
      if (candles[i].h <= candles[i-j].h || candles[i].h <= candles[i+j].h) isH = false;
      if (candles[i].l >= candles[i-j].l || candles[i].l >= candles[i+j].l) isL = false;
    }
    if (isH) highs.push(candles[i].h);
    if (isL) lows.push(candles[i].l);
  }
  return { highs, lows };
}

function clusterLevels(prices, tolerancePct = 0.0015) {
  if (!prices.length) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const tol = sorted[i] * tolerancePct;
    if (sorted[i] - cur[cur.length - 1] <= tol) cur.push(sorted[i]);
    else { clusters.push({ price: cur.reduce((a,b)=>a+b,0)/cur.length, count: cur.length }); cur = [sorted[i]]; }
  }
  clusters.push({ price: cur.reduce((a,b)=>a+b,0)/cur.length, count: cur.length });
  return clusters.filter(c => c.count >= 2);
}

function detectDoubleTopBottom(swings, atr, maxDist) {
  const res = [];
  const highs = swings.highs.slice();
  const lows = swings.lows.slice();
  const tol = atr * 0.5;
  for (let i = 0; i < highs.length - 1; i++) {
    if (Math.abs(highs[i] - highs[i+1]) < tol) {
      res.push({ type: "Double Top", level: (highs[i] + highs[i+1]) / 2, w: 4 });
    }
  }
  for (let i = 0; i < lows.length - 1; i++) {
    if (Math.abs(lows[i] - lows[i+1]) < tol) {
      res.push({ type: "Double Bottom", level: (lows[i] + lows[i+1]) / 2, w: 4 });
    }
  }
  return res.filter(p => Math.abs(p.level - swings.currentPrice) < maxDist).slice(0, 3);
}

// === MAIN ===
(async () => {
  try {
    console.log("🔍 Fetching OHLC XAU/USD...");
    const [h1, m15] = await Promise.all([fetchOhlc("1h", 120), fetchOhlc("15min", 120)]);
    const price = h1[h1.length - 1].c;
    const atrH1 = calcAtr(h1, 14);
    const atrM15 = calcAtr(m15, 14);

    console.log(`✅ H1: ${h1.length} candle | M15: ${m15.length} candle`);
    console.log(`💰 Harga: $${price.toFixed(2)} | ATR H1: $${atrH1?.toFixed(2)} | ATR M15: $${atrM15?.toFixed(2)}`);
    console.log("");

    // Filter 1: ATR gate
    if (atrH1 == null || atrH1 < ATR_MIN) {
      console.log(`⚠️  FILTER 1 AKTIF: ATR H1 $${atrH1?.toFixed(2)} < $${ATR_MIN}`);
      console.log("   Market kompresi ekstrem — pattern detection TIDAK RELIABEL.");
      console.log("   Semua candle kecil = false positive Doji/Harami.");
      console.log("");
      console.log("━━━ KESIMPULAN ━━━");
      console.log("❌ Pattern detection: SKIP (market kompresi).");
      console.log("   Rekomendasi: tunggu ekspansi ATR > $3 baru analisa pattern.");
      return;
    }

    // Filter 2: Near-price
    const maxDist = atrH1 * NEAR_ATR_MULT;
    console.log(`🎯 Filter aktif: ATR gate (>$${ATR_MIN}) ✅ | Near-price (±$${maxDist.toFixed(2)} = ${NEAR_ATR_MULT}×ATR) ✅ | Recency (${RECENT_WINDOW} candle) ✅`);
    console.log("");

    // Pattern detection
    console.log("━━━ CANDLESTICK PATTERNS ━━━");
    const patH1 = detectAll(h1);
    const patM15 = detectAll(m15);
    console.log(`\nH1 (${RECENT_WINDOW} candle terakhir) — ${patH1.length} pattern:`);
    patH1.forEach(p => console.log(`  • ${p.t} — ${p.at}`));
    if (!patH1.length) console.log("  (tidak ada pattern signifikan)");
    console.log(`\nM15 (${RECENT_WINDOW} candle terakhir) — ${patM15.length} pattern:`);
    patM15.forEach(p => console.log(`  • ${p.t} — ${p.at}`));
    if (!patM15.length) console.log("  (tidak ada pattern signifikan)");

    // S/R with near filter
    console.log("\n━━━ SUPPORT / RESISTANCE ━━━");
    const swings = findSwings(h1, 3);
    swings.currentPrice = price;
    const allSupports = clusterLevels(swings.lows.filter(p => p < price));
    const allResistances = clusterLevels(swings.highs.filter(p => p > price));

    const nearSupports = allSupports.filter(s => price - s.price < maxDist).sort((a,b) => b.price - a.price).slice(0, 3);
    const nearResistances = allResistances.filter(r => r.price - price < maxDist).sort((a,b) => a.price - b.price).slice(0, 3);

    console.log(`\nSupport (dalam ±$${maxDist.toFixed(2)}):`);
    nearSupports.forEach(s => console.log(`  • $${s.price.toFixed(2)} (${s.count} touches)`));
    if (!nearSupports.length) console.log("  (tidak ada support terdekat)");
    if (allSupports.length > nearSupports.length) console.log(`  (${allSupports.length - nearSupports.length} support lain lebih jauh dari ${NEAR_ATR_MULT}×ATR — dibuang)`);

    console.log(`\nResistance (dalam ±$${maxDist.toFixed(2)}):`);
    nearResistances.forEach(r => console.log(`  • $${r.price.toFixed(2)} (${r.count} touches)`));
    if (!nearResistances.length) console.log("  (tidak ada resistance terdekat)");
    if (allResistances.length > nearResistances.length) console.log(`  (${allResistances.length - nearResistances.length} resistance lain lebih jauh dari ${NEAR_ATR_MULT}×ATR — dibuang)`);

    // Chart patterns with near filter
    console.log("\n━━━ CHART PATTERNS ━━━");
    const dtb = detectDoubleTopBottom(swings, atrH1, maxDist);
    if (dtb.length) dtb.forEach(p => console.log(`  • ${p.type} di $${p.level.toFixed(2)}`));
    else console.log("  (tidak ada double top/bottom dalam range harga)");

    // Ringkasan
    console.log("\n━━━ RINGKASAN ━━━");
    const highConfidence = [...patH1, ...patM15].filter(p => p.w >= 3);
    if (highConfidence.length) {
      console.log(`⚡ Pattern penting (weight >= 3): ${highConfidence.map(p => p.t + " " + p.at.split(" @ ")[1]).join(", ")}`);
    } else {
      console.log("⚡ Tidak ada pattern signifikan. Semua noise/false positive.");
    }
    console.log(`📊 S/R relevan: ${nearSupports.length} support + ${nearResistances.length} resistance`);
    console.log(`📐 Chart pattern relevan: ${dtb.length}`);
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exit(1);
  }
})();
