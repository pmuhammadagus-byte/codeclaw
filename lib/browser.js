import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

let proc = null;
let browser = null;
let page = null;

export async function launch(opts = {}) {
  if (browser) return browser;
  const port = opts.port || 9222;
  proc = spawn("/root/.local/bin/lightpanda", ["--port", String(port), "--host", "127.0.0.1"], { stdio: "ignore" });
  await sleep(2000);
  browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}` });
  page = await browser.newPage();
  return browser;
}

export async function navigate(url) {
  await launch();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return { url: page.url() };
}

export async function click(selector) {
  await launch();
  await page.click(selector);
  return { clicked: selector };
}

export async function fill(selector, value) {
  await launch();
  await page.type(selector, value);
  return { filled: selector };
}

export async function extractText(selector) {
  await launch();
  const text = await page.$eval(selector, (el) => el.textContent);
  return { text };
}

export async function evalJS(script) {
  await launch();
  const result = await page.evaluate(script);
  return { result };
}

export async function close() {
  try { if (page) await page.close(); } catch {}
  try { if (browser) await browser.disconnect(); } catch {}
  if (proc) { try { proc.kill("SIGTERM"); } catch {} }
  browser = null; page = null; proc = null;
}