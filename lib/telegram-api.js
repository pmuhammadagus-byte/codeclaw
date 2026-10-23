import fs from "node:fs";

export class TelegramAPI {
  constructor(token) {
    if (!token) throw new Error("botToken kosong");
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileUrl = `https://api.telegram.org/file/bot${token}`;
  }

  async call(method, params = {}) {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || "unknown"} (${data.error_code || "?"})`);
    return data.result;
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
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return { path: destPath, size: buf.length };
  }
}
