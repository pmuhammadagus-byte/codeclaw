// 🥇 XAU/USD Analysis Module
const API = "https://api.twelvedata.com";

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  return s.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  const rs = ag / al;
  return 100 - (100 / (1 + rs));
}

function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }
  const s = trs.slice(-period);
  return s.reduce((a, b) => a + b, 0) / period;
}

export async function analyzeGold(config) {
  const apiKey = config.raw?.twelvedata?.apiKey || config.twelvedata?.apiKey;
  if (!apiKey) throw new Error("twelvedata.apiKey kosong. Isi via panel [7].");

  const url = `${API}/time_series?symbol=XAU/USD&interval=1h&outputsize=100&apikey=${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  let data;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } finally { clearTimeout(timer); }

  if (data.status === "error" || !data.values) throw new Error(`TwelveData: ${data.message || "no data"}`);

  const values = data.values.slice().reverse();
  if (values.length < 50) throw new Error(`Data kurang (${values.length}, butuh ≥50)`);

  const closes = values.map(v => parseFloat(v.close));
  const highs = values.map(v => parseFloat(v.high));
  const lows = values.map(v => parseFloat(v.low));
  const current = closes[closes.length - 1];
  const prev = closes[closes.length - 2];

  const rsi = calcRSI(closes);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const atr = calcATR(highs, lows, closes);

  const lastTs = values[values.length - 1].datetime;
  const ageMin = Math.round((Date.now() - new Date(lastTs + "Z").getTime()) / 60000);

  let signal = "WAIT", reason = [];
  const trendUp = sma20 && sma50 && current > sma20 && sma20 > sma50;
  const trendDown = sma20 && sma50 && current < sma20 && sma20 < sma50;
  const rsiOver = rsi < 30, rsiUnder = rsi > 70;

  if (trendUp && rsi < 60 && !rsiUnder) { signal = "BUY"; reason.push("Uptrend + RSI belum overbought"); }
  else if (trendDown && rsi > 40 && !rsiOver) { signal = "SELL"; reason.push("Downtrend + RSI belum oversold"); }
  else if (rsiOver) { reason.push("RSI oversold — tunggu reversal"); }
  else if (rsiUnder) { reason.push("RSI overbought — tunggu koreksi"); }
  else reason.push("Tidak ada setup jelas");

  const change = ((current - prev) / prev * 100);
  const sign = change >= 0 ? "+" : "";

  const L = [];
  L.push(`📊 *XAU/USD Analysis*`);
  L.push(`Harga: *$${current.toFixed(2)}* (${sign}${change.toFixed(2)}%)`);
  L.push(``);
  L.push(`RSI(14): ${rsi.toFixed(1)} — ${rsiOver ? "Oversold" : rsiUnder ? "Overbought" : "Netral"}`);
  L.push(`SMA20: $${sma20.toFixed(2)} | SMA50: $${sma50.toFixed(2)}`);
  L.push(`ATR(14): $${atr.toFixed(2)}`);
  L.push(``);
  L.push(`Sinyal: *${signal}*`);
  L.push(`_${reason.join("; ")}_`);

  if (signal === "BUY" || signal === "SELL") {
    const sl = atr * 1.5, tp1d = atr * 1.5, tp2d = atr * 3;
    let entry = current, slP, tp1, tp2;
    if (signal === "BUY") { slP = current - sl; tp1 = current + tp1d; tp2 = current + tp2d; }
    else { slP = current + sl; tp1 = current - tp1d; tp2 = current - tp2d; }
    L.push(``);
    L.push(`Entry: $${entry.toFixed(2)}`);
    L.push(`SL:    $${slP.toFixed(2)} (-$${Math.abs(entry - slP).toFixed(2)})`);
    L.push(`TP1:   $${tp1.toFixed(2)} (+$${Math.abs(tp1 - entry).toFixed(2)})`);
    L.push(`TP2:   $${tp2.toFixed(2)} (+$${Math.abs(tp2 - entry).toFixed(2)})`);
    L.push(`RR:    1.5:1 / 3:1`);
  }

  L.push(``);
  L.push(`⏱ Data: ${ageMin}m lalu${ageMin > 60 ? " ⚠️ STALE" : ""}`);
  return L.join("\n");
}
