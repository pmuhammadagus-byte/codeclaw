import { setupIPv4Dispatcher } from "./ipv4-lookup.js";
await setupIPv4Dispatcher();

import https from "node:https";
import dns from "node:dns";
import fs from "node:fs";

const TG_HOST = "api.telegram.org";

// Fallback IP pool — dipakai kalau DNS gagal. Telegram punya beberapa DC.
const TG_IPS = [
  "149.154.167.220",
  "149.154.167.221",
  "149.154.167.197",
  "149.154.175.50",
  "91.108.56.130",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NET_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN",
  "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET",
]);

function isNetErr(err) {
  const code = err?.code || err?.cause?.code;
  if (code && NET_CODES.has(code)) return true;
  return /ECONNRESET|socket hang up|other side closed|timeout|EAI_AGAIN|ENOTFOUND/i.test(String(err?.message || ""));
}

// Cache hasil resolve supaya tidak DNS lookup tiap request.
let cachedEntry = null;
let cachedAt = 0;
const DNS_TTL = 5 * 60 * 1000;

async function resolveTargets() {
  const now = Date.now();
  if (cachedEntry && now - cachedAt < DNS_TTL) return [cachedEntry];
  try {
    const addrs = await dns.promises.resolve4(TG_HOST);
    if (addrs?.length) {
      cachedEntry = addrs[0];
      cachedAt = now;
      // DNS jalan → pakai DNS, IP pool cuma cadangan.
      return [...addrs.slice(0, 3), ...TG_IPS.filter((ip) => !addrs.includes(ip))];
    }
  } catch {
    // DNS mati — pakai IP pool.
  }
  return TG_IPS;
}

export class TelegramAPI {
  constructor(token) {
    if (!token) throw new Error("botToken kosong");
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileUrl = `https://api.telegram.org/file/bot${token}`;
    this.timeoutMs = 45_000;
    this.maxAttempts = 4;
    this._targetIdx = 0;
  }

  _requestOnce(method, body, hostname, ip) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname,
        port: 443,
        path: `/bot${this.token}/${method}`,
        method: "POST",
        family: 4,
        servername: TG_HOST, // penting: SNI harus tetap api.telegram.org untuk TLS
        headers: {
          "Host": TG_HOST,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Connection": "close",
        },
        timeout: this.timeoutMs,
        ...(ip ? { lookup: (_h, _o, cb) => cb(null, ip, 4) } : {}),
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, text }));
        res.on("error", reject);
      });

      req.setTimeout(this.timeoutMs, () => {
        req.destroy(Object.assign(new Error(`Telegram ${method}: timeout`), { code: "ETIMEDOUT" }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  async call(method, params = {}) {
    const body = JSON.stringify(params);
    const targets = await resolveTargets();
    let lastErr;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const ip = targets[(this._targetIdx + attempt) % targets.length];
      const hostname = attempt === 0 ? TG_HOST : TG_HOST; // Host header & SNI selalu sama
      try {
        const response = await this._requestOnce(method, body, hostname, ip);

        let data;
        try {
          data = JSON.parse(response.text);
        } catch {
          // Respons rusak (biasanya halaman error proxy) → anggap network error, coba lagi.
          throw Object.assign(
            new Error(`Telegram ${method}: respons tidak valid (HTTP ${response.statusCode})`),
            { code: "EBADRESP" }
          );
        }

        if (!data.ok) {
          const retryAfter = data.parameters?.retry_after;
          const err = new Error(
            `Telegram ${method}: ${data.description || "unknown"} (${data.error_code || response.statusCode || "?"})`
          );
          // Rate limit → tunggu sesuai instruksi Telegram, lalu ulangi.
          if (data.error_code === 429 && retryAfter && attempt < this.maxAttempts - 1) {
            await sleep(Math.min(retryAfter, 30) * 1000);
            lastErr = err;
            continue;
          }
          // 5xx = server-side sementara → retry. 4xx lain = permanen.
          if (data.error_code >= 500 && attempt < this.maxAttempts - 1) {
            lastErr = err;
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw err;
        }

        // Sukses — geser target kalau sebelumnya sempat gagal.
        if (attempt > 0) this._targetIdx = (this._targetIdx + attempt) % targets.length;
        return data.result;
      } catch (err) {
        lastErr = err;
        const retryable = isNetErr(err) || err.code === "EBADRESP";
        if (!retryable || attempt === this.maxAttempts - 1) throw err;
        await sleep(Math.min(300 * 2 ** attempt, 4000));
      }
    }

    throw lastErr ?? new Error(`Telegram ${method}: gagal tanpa error`);
  }

  getMe() { return this.call("getMe"); }
  getUpdates(offset, timeout = 30) {
    return this.call("getUpdates", { offset, timeout, allowed_updates: ["message"] });
  }
  sendMessage(chatId, text, opts = {}) {
    return this.call("sendMessage", {
      chat_id: chatId, text, parse_mode: "HTML",
      disable_web_page_preview: true, ...opts,
    });
  }
  editMessageText(chatId, messageId, text, opts = {}) {
    return this.call("editMessageText", {
      chat_id: chatId, message_id: messageId, text,
      parse_mode: "HTML", disable_web_page_preview: true, ...opts,
    }).catch(e => {
      if (e.message?.includes("message is not modified")) return null;
      throw e;
    });
  }

  deleteMessage(chatId, messageId) {
    return this.call("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => null);
  }

  sendChatAction(chatId, action = "typing") {
    return this.call("sendChatAction", { chat_id: chatId, action }).catch(() => {});
  }
  getFile(fileId) { return this.call("getFile", { file_id: fileId }); }
  async downloadFile(fileId, destPath) {
    const file = await this.getFile(fileId);
    const url = `${this.fileUrl}/${file.file_path}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return { path: destPath, size: buf.length };
  }
}
