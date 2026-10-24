import fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
