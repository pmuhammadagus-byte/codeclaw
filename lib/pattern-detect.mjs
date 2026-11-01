// Pattern detection library — pure functions, no I/O.
// Caller provides OHLC arrays; returns structured result.

const ATR_MIN = 3;
const NEAR_ATR_MULT = 3;
const RECENT_WINDOW = 10;

const body = c => Math.abs(c.c - c.o);
const range = c => c.h - c.l;
const upperWick = c => c.h - Math.max(c.c, c.o);
const lowerWick = c => Math.min(c.c, c.o) - c.l;
const isBull = c => c.c > c.o;
const isBear = c => c.c < c.o;

export function calcAtr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
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
  return patterns.sort((a, b) => b.w - a.w).slice(0, 5);
}

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

function detectDoubleTopBottom(swings, atr, maxDist, currentPrice) {
  const res = [];
  const tol = atr * 0.5;
  for (let i = 0; i < swings.highs.length - 1; i++) {
    if (Math.abs(swings.highs[i] - swings.highs[i+1]) < tol) {
      res.push({ type: "Double Top", level: (swings.highs[i] + swings.highs[i+1]) / 2, w: 4 });
    }
  }
  for (let i = 0; i < swings.lows.length - 1; i++) {
    if (Math.abs(swings.lows[i] - swings.lows[i+1]) < tol) {
      res.push({ type: "Double Bottom", level: (swings.lows[i] + swings.lows[i+1]) / 2, w: 4 });
    }
  }
  return res.filter(p => Math.abs(p.level - currentPrice) < maxDist).slice(0, 3);
}

export function detectPatterns(h1, m15) {
  if (!h1 || h1.length < 20 || !m15 || m15.length < 20) {
    return { ok: false, skipReason: "OHLC tidak cukup" };
  }
  const price = h1[h1.length - 1].c;
  const atrH1 = calcAtr(h1, 14);
  const atrM15 = calcAtr(m15, 14);
  if (atrH1 == null || atrH1 < ATR_MIN) {
    return { ok: false, skipReason: `ATR H1 $${atrH1?.toFixed(2)} < $${ATR_MIN} (market kompresi)`, price, atrH1, atrM15 };
  }
  const maxDist = atrH1 * NEAR_ATR_MULT;
  const patH1 = detectAll(h1);
  const patM15 = detectAll(m15);
  const swings = findSwings(h1, 3);
  const allSupports = clusterLevels(swings.lows.filter(p => p < price));
  const allResistances = clusterLevels(swings.highs.filter(p => p > price));
  const nearSupports = allSupports.filter(s => price - s.price < maxDist).sort((a,b)=>b.price-a.price).slice(0,3);
  const nearResistances = allResistances.filter(r => r.price - price < maxDist).sort((a,b)=>a.price-b.price).slice(0,3);
  const dtb = detectDoubleTopBottom(swings, atrH1, maxDist, price);
  return {
    ok: true, price, atrH1, atrM15, maxDist,
    patH1, patM15, nearSupports, nearResistances, chartPatterns: dtb,
    skippedFarSupports: allSupports.length - nearSupports.length,
    skippedFarResistances: allResistances.length - nearResistances.length,
  };
}

export function formatPatternsForPrompt(r) {
  if (!r) return "";
  if (!r.ok) {
    return `\nSECTION 6 DATA (CANDLESTICK & PATTERN):\n- Pattern detection: SKIP — ${r.skipReason}\n- WAJIB tulis di section 6: "Pattern detection: SKIP (${r.skipReason}). Market sedang tight, tunggu ekspansi ATR."\n`;
  }
  const f = v => `$${v.toFixed(2)}`;
  const L = ["", "SECTION 6 DATA (CANDLESTICK & PATTERN, dari deteksi deterministik):"];
  L.push(`- ATR H1: ${f(r.atrH1)} | window relevan: ±${f(r.maxDist)} dari harga`);
  const highPat = [...r.patH1, ...r.patM15].filter(p => p.w >= 3);
  if (highPat.length) {
    L.push(`- Candlestick pattern penting (weight>=3):`);
    highPat.slice(0, 5).forEach(p => L.push(`  • ${p.t} di ${p.at}`));
  } else {
    L.push(`- Candlestick pattern: tidak ada yang signifikan (hanya noise/Doji kecil)`);
  }
  const h1Pat = r.patH1.filter(p => p.w >= 3);
  const m15Pat = r.patM15.filter(p => p.w >= 3);
  if (!h1Pat.length && !m15Pat.length && !r.patH1.length && !r.patM15.length) {
    L.push("- Tidak ada pattern terdeteksi di H1/M15");
  }
  if (r.nearSupports.length) {
    L.push(`- Support (dalam ±${f(r.maxDist)}): ${r.nearSupports.map(s=>`${f(s.price)} (${s.count} touches)`).join(", ")}`);
  }
  if (r.nearResistances.length) {
    L.push(`- Resistance (dalam ±${f(r.maxDist)}): ${r.nearResistances.map(x=>`${f(x.price)} (${x.count} touches)`).join(", ")}`);
  }
  if (r.chartPatterns.length) {
    L.push(`- Chart pattern: ${r.chartPatterns.map(p=>`${p.type} @ ${f(p.level)}`).join(", ")}`);
  } else {
    L.push("- Chart pattern: tidak ada double top/bottom dalam range harga");
  }
  L.push("");
  L.push("ATURAN SECTION 6: WAJIB tampilkan pattern/S/R di atas APA ADANYA. Kalau tidak ada → tulis 'tidak ada pattern signifikan'. JANGAN ngarang pattern.");
  return L.join("\n");
}
