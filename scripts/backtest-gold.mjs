#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONFIG = path.join(ROOT, "config.json");

const SYMBOL = "XAU/USD";
const INTERVAL = "1day";
const OUTPUTSIZE = 100;

function loadKey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    const k = cfg?.twelvedata?.apiKey || cfg?.apiKeys?.twelvedata || process.env.TWELVEDATA_KEY;
    if (!k) throw new Error("twelvedata.apiKey tidak ditemukan di config.json");
    return k;
  } catch (e) {
    throw new Error(`Gagal baca config: ${e.message}`);
  }
}

function sma(arr, len) {
  if (arr.length < len) return null;
  let sum = 0;
  for (let i = arr.length - len; i < arr.length; i++) sum += arr[i];
  return sum / len;
}

function rsi(closes, len = 14) {
  if (closes.length < len + 1) return null;
  let gain = 0, loss = 0;
  for (let i = closes.length - len; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  const rs = gain / (loss || 1e-12);
  return 100 - 100 / (1 + rs);
}

function atr(candles, len = 14) {
  if (candles.length < len + 1) return null;
  let sum = 0;
  for (let i = candles.length - len; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    sum += tr;
  }
  return sum / len;
}

function adx(candles, len = 14) {
  if (candles.length < (len * 2) + 1) return null;
  // Simplified ADX (Wilder) approximation cukup untuk backtest
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = candles.length - len; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const up = c.high - p.high;
    const down = p.low - c.low;
    plusDM += up > down && up > 0 ? up : 0;
    minusDM += down > up && down > 0 ? down : 0;
    tr += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1e-12)) * 100;
  // Rough ADX smoothing
  return dx;
}

function getReco(closes, candles) {
  const rsiVal = rsi(closes);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const adxVal = adx(candles);
  if (rsiVal == null || sma20 == null || sma50 == null) return { reco: "WAIT", rsiVal, sma20, sma50, adxVal };

  let score = 0;
  if (sma20 > sma50) score += 1; else if (sma20 < sma50) score -= 1;
  if (rsiVal < 35) score += 1;
  if (rsiVal > 65) score -= 1;
  if (adxVal != null && adxVal > 25) score += sma20 > sma50 ? 0.5 : -0.5;

  if (score >= 1.5) return { reco: "BUY", rsiVal, sma20, sma50, adxVal };
  if (score <= -1.5) return { reco: "SELL", rsiVal, sma20, sma50, adxVal };
  return { reco: "WAIT", rsiVal, sma20, sma50, adxVal };
}

async function main() {
  const key = loadKey();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(SYMBOL)}&interval=${INTERVAL}&outputsize=${OUTPUTSIZE}&apikey=${key}`;
  console.log(`Fetching ${SYMBOL} ${INTERVAL} last ${OUTPUTSIZE} days...`);
  const res = await fetch(url);
  const json = await res.json();
  if (json.status === "error") throw new Error(json.message);
  const values = (json.values || []).slice().reverse(); // oldest -> newest
  if (values.length < 60) throw new Error("Data tidak cukup untuk backtest");

  const candles = values.map(v => ({
    date: v.datetime,
    open: +v.open,
    high: +v.high,
    low: +v.low,
    close: +v.close,
  }));

  const trades = [];
  // Simulasi per hari mulai dari index 55 (butuh history untuk indikator)
  for (let i = 55; i < candles.length - 1; i++) {
    const histCloses = candles.slice(0, i + 1).map(c => c.close);
    const histCandles = candles.slice(0, i + 1);
    const sig = getReco(histCloses, histCandles);
    if (sig.reco === "WAIT") continue;

    const entry = candles[i + 1].open; // next open
    const a = atr(histCandles);
    if (a == null) continue;
    const slDist = a * 1.5;
    const tp1Dist = a * 1.5;
    const tp2Dist = a * 3.0;

    let sl, tp1, tp2;
    if (sig.reco === "BUY") {
      sl = entry - slDist;
      tp1 = entry + tp1Dist;
      tp2 = entry + tp2Dist;
    } else {
      sl = entry + slDist;
      tp1 = entry - tp1Dist;
      tp2 = entry - tp2Dist;
    }

    // Cek hasil di hari-hari berikutnya (max 5 hari hold)
    let result = null;
    let exitPrice = null;
    let exitReason = null;
    for (let j = i + 1; j < Math.min(i + 6, candles.length); j++) {
      const c = candles[j];
      if (sig.reco === "BUY") {
        if (c.low <= sl) { result = "LOSS"; exitPrice = sl; exitReason = "SL"; break; }
        if (c.high >= tp2) { result = "WIN"; exitPrice = tp2; exitReason = "TP2"; break; }
        if (c.high >= tp1 && result == null) { /* track tp1 */ }
      } else {
        if (c.high >= sl) { result = "LOSS"; exitPrice = sl; exitReason = "SL"; break; }
        if (c.low <= tp2) { result = "WIN"; exitPrice = tp2; exitReason = "TP2"; break; }
      }
    }
    if (result == null) {
      // close at end of hold period
      const last = candles[Math.min(i + 5, candles.length - 1)];
      exitPrice = last.close;
      if (sig.reco === "BUY") result = exitPrice >= entry ? "WIN" : "LOSS";
      else result = exitPrice <= entry ? "WIN" : "LOSS";
      exitReason = "HOLD_CLOSE";
    }

    const pnl = sig.reco === "BUY" ? (exitPrice - entry) : (entry - exitPrice);
    trades.push({ date: candles[i + 1].date, side: sig.reco, entry, sl, tp2, exitPrice, exitReason, result, pnl });
  }

  const wins = trades.filter(t => t.result === "WIN").length;
  const losses = trades.filter(t => t.result === "LOSS").length;
  const slHits = trades.filter(t => t.exitReason === "SL").length;
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;

  console.log("\n" + "=".repeat(60));
  console.log(`BACKTEST ${SYMBOL} | ${INTERVAL} | Last ${OUTPUTSIZE} days`);
  console.log("=".repeat(60));
  console.log(`Total trades : ${trades.length}`);
  console.log(`Wins          : ${wins}`);
  console.log(`Losses        : ${losses}`);
  console.log(`SL hits       : ${slHits}`);
  console.log(`Win Rate      : ${winRate.toFixed(2)}%`);
  console.log(`Total Profit  : ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} USD/oz (point)`);
  console.log("=".repeat(60));
  if (trades.length) {
    console.log("\nLast 5 trades:");
    for (const t of trades.slice(-5)) {
      console.log(`  ${t.date} | ${t.side.padEnd(4)} | Entry ${t.entry.toFixed(2)} | Exit ${t.exitPrice.toFixed(2)} (${t.exitReason}) | ${t.result} | PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}`);
    }
  }
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
