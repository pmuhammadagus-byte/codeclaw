const CACHE = new Map();
const TTL = 5 * 60 * 1000;

export async function fetchOhlc(apiKey, symbol, interval, size) {
  if (!apiKey) throw new Error("twelvedata key kosong");
  const ck = `${symbol}|${interval}|${size}`;
  const cached = CACHE.get(ck);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${size}&apikey=${apiKey}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!j.values || !Array.isArray(j.values)) throw new Error(`ohlc ${interval}: ${j.message || j.code || "empty"}`);
  const data = j.values.slice().reverse().map(v => ({
    t: v.datetime,
    o: parseFloat(v.open), h: parseFloat(v.high),
    l: parseFloat(v.low), c: parseFloat(v.close),
  })).filter(x => Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
  CACHE.set(ck, { data, ts: Date.now() });
  return data;
}

function calcAtr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h, l = candles[i].l, pc = candles[i-1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function findSwings(candles, window = 3) {
  const highs = [], lows = [];
  for (let i = window; i < candles.length - window; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= window; j++) {
      if (candles[i].h <= candles[i-j].h || candles[i].h <= candles[i+j].h) isHigh = false;
      if (candles[i].l >= candles[i-j].l || candles[i].l >= candles[i+j].l) isLow = false;
    }
    if (isHigh) highs.push({ idx: i, price: candles[i].h });
    if (isLow)  lows.push({ idx: i, price: candles[i].l });
  }
  return { highs, lows };
}

function findFvgs(candles, minGap) {
  const bull = [], bear = [];
  for (let i = 2; i < candles.length; i++) {
    const gB = candles[i].l - candles[i-2].h;
    if (gB >= minGap) bull.push({ top: candles[i].l, bottom: candles[i-2].h, idx: i });
    const gS = candles[i-2].l - candles[i].h;
    if (gS >= minGap) bear.push({ top: candles[i-2].l, bottom: candles[i].h, idx: i });
  }
  const lowSince  = (idx) => Math.min(...candles.slice(idx).map(c => c.l));
  const highSince = (idx) => Math.max(...candles.slice(idx).map(c => c.h));
  const activeBull = bull.filter(g => lowSince(g.idx) > g.bottom);
  const activeBear = bear.filter(g => highSince(g.idx) < g.top);
  return { bull: activeBull.slice(-3), bear: activeBear.slice(-3) };
}

function findObs(candles, atr) {
  const bull = [], bear = [];
  const move = Math.max(atr * 1.2, 5);
  for (let i = 1; i < candles.length - 2; i++) {
    const c = candles[i];
    if (c.c < c.o) {
      const rally = candles[i+1].c - c.l;
      if (rally > move) bull.push({ top: c.h, bottom: c.l, idx: i });
    }
    if (c.c > c.o) {
      const dump = c.h - candles[i+1].c;
      if (dump > move) bear.push({ top: c.h, bottom: c.l, idx: i });
    }
  }
  return { bull: bull.slice(-3), bear: bear.slice(-3) };
}

export async function analyzeOhlcForIct(apiKey, symbol = "XAU/USD", currentPrice) {
  const [h1, m15] = await Promise.all([
    fetchOhlc(apiKey, symbol, "1h", 120),
    fetchOhlc(apiKey, symbol, "15min", 120),
  ]);
  if (!h1.length || !m15.length) throw new Error("ohlc empty");

  const atrH1 = calcAtr(h1, 14) || 30;
  const minGapH1 = Math.max(atrH1 * 0.15, 2);
  const minGapM15 = Math.max(atrH1 * 0.08, 1);

  const swingsH1 = findSwings(h1, 3);
  const fvgsH1 = findFvgs(h1, minGapH1);
  const obsH1 = findObs(h1, atrH1);
  const swingsM15 = findSwings(m15, 3);
  const fvgsM15 = findFvgs(m15, minGapM15);

  const price = currentPrice || h1[h1.length - 1].c;
  const bsl = swingsH1.highs.filter(s => s.price > price).sort((a,b)=>a.price-b.price).slice(0,3);
  const ssl = swingsH1.lows.filter(s => s.price < price).sort((a,b)=>b.price-a.price).slice(0,3);

  return {
    atrH1, minGapH1,
    rawH1: h1, rawM15: m15,
    h1Last3: h1.slice(-3),
    fvgsH1, obsH1, swingsH1, swingsM15, fvgsM15,
    bsl, ssl,
    counts: {
      h1: h1.length, m15: m15.length,
      swings: swingsH1.highs.length + swingsH1.lows.length,
      fvgBull: fvgsH1.bull.length, fvgBear: fvgsH1.bear.length,
      obBull: obsH1.bull.length, obBear: obsH1.bear.length,
    },
  };
}

export function formatOhlcForPrompt(o, price) {
  if (!o) return "";
  const f = v => `$${v.toFixed(2)}`;
  const r = z => `${f(z.bottom)}–${f(z.top)}`;
  const L = ["", "DATA OHLC REAL (TwelveData, WAJIB dipakai — JANGAN [perlu chart live] untuk yang tersedia):"];
  L.push(`- ATR(14) H1: ${f(o.atrH1)} | min gap FVG H1: ${f(o.minGapH1)}`);
  L.push(`- H1 candles: ${o.counts.h1} | M15: ${o.counts.m15} | swings: ${o.counts.swings}`);

  if (o.fvgsH1.bull.length) L.push(`- FVG BULL H1 aktif: ${o.fvgsH1.bull.map(r).join(", ")}`);
  if (o.fvgsH1.bear.length) L.push(`- FVG BEAR H1 aktif: ${o.fvgsH1.bear.map(r).join(", ")}`);
  if (o.fvgsM15.bull.length) L.push(`- FVG BULL M15: ${o.fvgsM15.bull.map(r).join(", ")}`);
  if (o.fvgsM15.bear.length) L.push(`- FVG BEAR M15: ${o.fvgsM15.bear.map(r).join(", ")}`);

  if (o.obsH1.bull.length) L.push(`- OB BULL H1 (demand): ${o.obsH1.bull.map(r).join(", ")}`);
  if (o.obsH1.bear.length) L.push(`- OB BEAR H1 (supply): ${o.obsH1.bear.map(r).join(", ")}`);

  if (o.bsl.length) L.push(`- BSL (swing high di atas harga): ${o.bsl.map(s=>f(s.price)).join(", ")}`);
  if (o.ssl.length) L.push(`- SSL (swing low di bawah harga): ${o.ssl.map(s=>f(s.price)).join(", ")}`);

  if (!o.fvgsH1.bull.length && !o.fvgsH1.bear.length) L.push("- FVG H1: tidak ada gap signifikan saat ini (pasar tight)");
  if (!o.obsH1.bull.length && !o.obsH1.bear.length) L.push("- OB H1: tidak ada order block valid saat ini");

  L.push("- Last 3 H1 candles (O/H/L/C):");
  o.h1Last3.forEach(c => L.push(`  ${c.t}: ${f(c.o)} / ${f(c.h)} / ${f(c.l)} / ${f(c.c)}`));
  L.push("");
  L.push("ATURAN LEVEL: untuk section LIQUIDITY, MARKET STRUCTURE, KILL ZONE — WAJIB pakai level FVG/OB/BSL/SSL di atas. Tulis '[perlu chart live]' HANYA jika kategori benar-benar kosong.");
  return L.join("\n");
}
