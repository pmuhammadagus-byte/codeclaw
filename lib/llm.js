await setupIPv4Dispatcher();

import { setupIPv4Dispatcher } from "./ipv4-lookup.js";

const RETRYABLE = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeError(err) {
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const detail = cause?.message || err?.message || "unknown";
  return code ? `${code}: ${detail}` : detail;
}

function isRetryable(err) {
  const code = err?.cause?.code || err?.code;
  if (code && RETRYABLE.has(code)) return true;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return true;
  const msg = String(err?.message || "");
  return /fetch failed|socket hang up|other side closed|network|timeout/i.test(msg);
}

export class LLM {
  constructor(cfg) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.maxTokens = cfg.maxTokens ?? 8192;
    this.temperature = cfg.temperature ?? 0.2;
    this.maxRetries = cfg.maxRetries ?? 3;
    this.timeoutMs = cfg.timeoutMs ?? 180_000;
  }

  async chat({ messages, tools, onStream }) {
    const body = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true,
    };
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const payload = JSON.stringify(body);
    let lastErr;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(500 * 2 ** (attempt - 1), 8000);
        await sleep(backoff);
      }
      try {
        return await this._chatOnce(payload, onStream);
      } catch (err) {
        lastErr = err;
        if (err.fatal || !isRetryable(err) || attempt === this.maxRetries) break;
      }
    }

    throw new Error(
      `LLM request gagal setelah ${this.maxRetries + 1} percobaan (${this.baseUrl}, model=${this.model}): ${describeError(lastErr)}`,
      { cause: lastErr }
    );
  }

  async _chatOnce(payload, onStream) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: payload,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
      const retryableStatus = res.status === 408 || res.status === 429 || res.status >= 500;
      err.fatal = !retryableStatus;
      throw err;
    }

    let content = "";
    const toolCalls = [];
    let finishReason = null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          let chunk;
          try { chunk = JSON.parse(data); } catch { continue; }

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const delta = choice.delta ?? {};
          if (delta.content) {
            content += delta.content;
            if (onStream) onStream(delta.content);
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              if (!toolCalls[i]) toolCalls[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
              if (tc.id) toolCalls[i].id = tc.id;
              if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
            }
          }
        }
      }
    } catch (err) {
      // Stream putus di tengah jalan. Retry hanya aman kalau belum ada
      // konten/tool_call yang sudah dikirim ke user (hindari duplikasi output
      // dan pemborosan token).
      const emitted = content.length > 0 || toolCalls.some(Boolean);
      if (emitted) err.fatal = true;
      throw err;
    } finally {
      try { await reader.cancel(); } catch {}
    }

    const message = { role: "assistant", content };
    const calls = toolCalls.filter(Boolean);
    if (calls.length > 0) message.tool_calls = calls;
    return { message, finishReason };
  }
}
