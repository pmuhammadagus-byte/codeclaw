#!/usr/bin/env node
// Backtest XAU/USD sederhana dengan out-of-sample + slippage
// ponytail: pakai ATR untuk SL/TP, slippage $0.5/oz per trade (spread+slippage)

import { loadConfig } from "../lib/config.js";

const SYMBOL = "XAU/USD";
const INTERVAL = "1day";
const SLIPPAGE = 0.5;

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const win = values.slice(-period);
  return win.reduce((a, b) => a + b, 0) / period;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    sum += tr;
  }
  return sum / period;
}

function getReco(closes, candles) {
  const r = rsi(closes, 14);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  let score = 0;
  if (r != null) {
    if (r < 30) score += 2;
    else if (r > 70) score -= 2;
    else if (r < 45) score += 1;
    else if (r > 60) score -= 1;
  }
  if (s20 != null && closes.at(-1) > s20) score += 1;
  else if (s20 != null) score -= 1;
  if (s20 != null && s50 != null) {
    if (s20 > s50) score += 1; else score -= 1;
  }
  return { reco: score >= 2 ? "BUY" : score <= -2 ? "SELL" : "WAIT", rsi: r, score };
}

async function fetchCandles(key, outputsize = 200) {
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1day&outputsize=${outputsize}&apikey=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`twelvedata HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === "error") throw new Error(json.message);
  const values = Array.isArray(json.values) ? json.values.slice().reverse() : [];
  return values.map(v => ({
    date: v.datetime,
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
  }));
}

function runPeriod(candles, startIdx, endIdx) {
  const trades = [];
  for (let i = Math.max(55, startIdx); i < endIdx - 1; i++) {
    const histCloses = candles.slice(0, i + 1).map(c => c.close);
    const histCandles = candles.slice(0, i + 1);
    const sig = getReco(histCloses, histCandles);
    if (sig.reco === "WAIT") continue;

    const entry = candles[i + 1].open;
    const a = atr(histCandles);
    if (a == null) continue;
    const slDist = a * 1.5;
    const tp2Dist = a * 3.0;

    let sl, tp2;
    if (sig.reco === "BUY") {
      sl = entry - slDist;
      tp2 = entry + tp2Dist;
    } else {
      sl = entry + slDist;
      tp2 = entry - tp2Dist;
    }

    let result = null;
    let exitPrice = null;
    let exitReason = null;
    for (let j = i + 1; j < Math.min(i + 6, endIdx); j++) {
      const c = candles[j];
      if (sig.reco === "BUY") {
        if (c.low <= sl) { result = "LOSS"; exitPrice = sl; exitReason = "SL"; break; }
        if (c.high >= tp2) { result = "WIN"; exitPrice = tp2; exitReason = "TP2"; break; }
      } else {
        if (c.high >= sl) { result = "LOSS"; exitPrice = sl; exitReason = "SL"; break; }
        if (c.low <= tp2) { result = "WIN"; exitPrice = tp2; exitReason = "TP2"; break; }
      }
    }
    if (result == null) {
      const lastBar = candles[Math.min(i + 5, endIdx - 1)];
      exitPrice = lastBar.close;
      if (sig.reco === "BUY") result = exitPrice >= entry ? "WIN" : "LOSS";
      else result = exitPrice <= entry ? "WIN" : "LOSS";
      exitReason = "HOLD_CLOSE";
    }

    const rawPnl = sig.reco === "BUY" ? (exitPrice - entry) : (entry - exitPrice);
    const pnl = rawPnl - SLIPPAGE;
    trades.push({ date: candles[i + 1].date, side: sig.reco, entry, sl, tp2, exitPrice, exitReason, result, pnl, rawPnl });
  }
  return trades;
}

function summarize(label, trades) {
  const wins = trades.filter(t => t.result === "WIN").length;
  const losses = trades.filter(t => t.result === "LOSS").length;
  const slHits = trades.filter(t => t.exitReason === "SL").length;
  const totalPnlNet = trades.reduce((a, t) => a + t.pnl, 0);
  const totalPnlRaw = trades.reduce((a, t) => a + (t.rawPnl || 0), 0);
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;

  console.log("\n" + "=".repeat(60));
  console.log(label);
  console.log("=".repeat(60));
  console.log(`Total trades : ${trades.length}`);
  console.log(`Wins          : ${wins}`);
  console.log(`Losses        : ${losses}`);
  console.log(`SL hits       : ${slHits}`);
  console.log(`Win Rate      : ${winRate.toFixed(2)}%`);
  console.log(`Profit (raw)  : ${totalPnlRaw >= 0 ? "+" : ""}${totalPnlRaw.toFixed(2)} USD/oz`);
  console.log(`Profit (net)  : ${totalPnlNet >= 0 ? "+" : ""}${totalPnlNet.toFixed(2)} USD/oz (after $${SLIPPAGE.toFixed(2)} slippage/trade)`);
  console.log("=".repeat(60));
  if (trades.length) {
    console.log("\nLast 5 trades:");
    for (const t of trades.slice(-5)) {
      console.log(`  ${t.date} | ${t.side.padEnd(4)} | Entry ${t.entry.toFixed(2)} | Exit ${t.exitPrice.toFixed(2)} (${t.exitReason}) | ${t.result} | PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}`);
    }
  }
  return { trades: trades.length, wins, losses, slHits, winRate, totalPnlNet, totalPnlRaw };
}

async function main() {
  const { twelveKey } = await loadConfig();
  if (!twelveKey) throw new Error("TWELVE_DATA_KEY missing in config");
  console.log("Fetching XAU/USD 1day last 200 days...");
  const candles = await fetchCandles(twelveKey, 200);
  if (candles.length < 150) throw new Error(`Not enough data: ${candles.length} bars`);

  // Out-of-Sample: 100 hari pertama (in-sample) vs 100 hari terakhir (out-of-sample)
  const total = candles.length;
  const split = Math.max(100, total - 100);
  const inSample = candles.slice(0, split);
  const outSample = candles.slice(split);

  console.log(`Data: ${candles.length} bars | In-Sample: ${inSample.length} | Out-of-Sample: ${outSample.length}`);

  // Backtest in-sample
  const tIn = runPeriod(candles, 0, split);
  summarize(`IN-SAMPLE (${inSample[0].date} -> ${inSample.at(-1).date})`, tIn);

  // Backtest out-of-sample (gunakan history penuh untuk indikator)
  const tOut = runPeriod(candles, split, total);
  summarize(`OUT-OF-SAMPLE (${outSample[0].date} -> ${outSample.at(-1).date})`, tOut);
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
