import fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function splitForTelegram(text, max = 4000) {
  const s = String(text ?? "");
  if (s.length <= max) return [s];
  const parts = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < Math.floor(max * 0.5)) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.length) parts.push(rest);
  return parts;
}

export class TelegramAPI {
  constructor(token) {
    if (!token) throw new Error("botToken kosong");
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileUrl = `https://api.telegram.org/file/bot${token}`;
  }

  async call(method, params = {}) {
    const url = `${this.baseUrl}/${method}`;
    const dataStr = JSON.stringify(params).replace(/'/g, "'\\''"); // Escape single quote untuk bash
    const cmd = `curl -s -X POST "${url}" -H "Content-Type: application/json" -d '${dataStr}' --max-time 35`;
    
    try {
      const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
      const json = JSON.parse(stdout);
      if (!json.ok) throw new Error(`Telegram ${method}: ${json.description || "unknown"} (${json.error_code || "?"})`);
      return json.result;
    } catch (e) {
      if (e.message.includes("SyntaxError")) throw new Error(`Telegram ${method}: Invalid JSON response.`);
      throw new Error(`Telegram ${method}: ${e.message}`);
    }
  }

  getMe() { return this.call("getMe"); }
  
  getUpdates(offset, timeout = 30) {
    return this.call("getUpdates", { offset, timeout, allowed_updates: ["message"] });
  }
  
  sendMessage(chatId, text, opts = {}) {
    const s = String(text ?? "");
    const MAX = 4000;
    if (s.length > MAX && !opts.__noSplit) {
      const parts = splitForTelegram(s, MAX);
      console.warn("[tg] message too long, split into", parts.length, "parts");
      return (async () => {
        let last;
        for (const p of parts) last = await this.sendMessage(chatId, p, { ...opts, __noSplit: true });
        return last;
      })();
    }
    const { __noSplit, ...cleanOpts } = opts;
    const payload = {
      chat_id: chatId, text, parse_mode: "HTML",
      disable_web_page_preview: true, ...cleanOpts,
    };
    return this.call("sendMessage", payload).catch((err) => {
      const msg = String(err?.message || "");
      if (/can't parse entities|Bad Request: can't parse/i.test(msg)) {
        const { parse_mode, ...rest } = payload;
        console.warn("[tg] HTML parse failed, retry plain text:", msg.slice(0, 80));
        return this.call("sendMessage", rest);
      }
      throw err;
    });
  }
  
  editMessageText(chatId, messageId, text, opts = {}) {
    const payload = {
      chat_id: chatId, message_id: messageId, text,
      parse_mode: "HTML", disable_web_page_preview: true, ...opts,
    };
    return this.call("editMessageText", payload).catch((e) => {
      const msg = String(e?.message || "");
      if (msg.includes("message is not modified")) return null;
      if (/can't parse entities|Bad Request: can't parse/i.test(msg)) {
        const { parse_mode, ...rest } = payload;
        console.warn("[tg] HTML parse failed (edit), retry plain text:", msg.slice(0, 80));
        return this.call("editMessageText", rest);
      }
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
    const cmd = `curl -s -o "${destPath}" "${url}" --max-time 60`;
    try {
      await execAsync(cmd);
      const stats = fs.statSync(destPath);
      return { path: destPath, size: stats.size };
    } catch (e) {
      throw new Error(`Gagal download file: ${e.message}`);
    }
  }
}
