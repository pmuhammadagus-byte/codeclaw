// MCP Client Manager untuk CodeClaw
// Membaca config.mcp.servers, spawn server, list tools, register ke tool registry.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import fs from "node:fs";

import { z } from "zod";

const LooseToolsResult = z.object({ tools: z.array(z.any()) });


function readRawConfig() {
  const path = "/root/codeclaw/config.json";
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (e) {
    console.warn(`[mcp] gagal baca ${path}: ${e.message}`);
    return {};
  }
}


const clients = new Map(); // serverName -> { client, transport, tools }

/**
 * Start semua MCP server dari config.mcp.servers
 * @param {object} cfg - config.json object
 * @returns {Promise<Array<{name: string, tools: Array}>>}
 */
export async function startMcpServers(cfg) {
  const _raw = (cfg && cfg.mcp && cfg.mcp.servers) ? cfg : readRawConfig();
  const servers = _raw?.mcp?.servers || {};
  const results = [];

  for (const [name, spec] of Object.entries(servers)) {
    if (spec.enabled === false) {
      console.log(`[mcp] skip ${name} (disabled)`);
      continue;
    }
    if (!spec.command && !spec.url) {
      console.warn(`[mcp] skip ${name}: no command & no url`);
      continue;
    }

    try {
      let transport;
      if (spec.url) {
        // Remote MCP (Streamable HTTP): GitHub, Vercel, Cloudflare, Supabase, dll
        transport = new StreamableHTTPClientTransport(new URL(spec.url), {
          requestInit: {
            headers: spec.headers || {},
          },
        });
      } else {
        // Local MCP (stdio): Twelve Data via uvx, filesystem via npx
        transport = new StdioClientTransport({
          command: spec.command,
          args: spec.args || [],
          env: { ...process.env, ...(spec.env || {}) },
          stderr: "pipe",
        });
      }

      const client = new Client(
        { name: `codeclaw-${name}`, version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      let toolList;
      try {
        toolList = await client.listTools();
      } catch (e) {
        console.warn(`[mcp] ${name}: listTools strict gagal, fallback raw...`);
        const raw = await client.request({ method: "tools/list" }, LooseToolsResult);
        toolList = {
          tools: (raw.tools || []).map(t => {
            const fixed = { ...t };
            if (fixed.outputSchema && fixed.outputSchema.type !== "object") {
              delete fixed.outputSchema;
            }
            return fixed;
          }),
        };
      }
      const tools = (toolList?.tools || []).map((t) => ({
        ...t,
        // prefix supaya tidak bentrok dengan tool native CodeClaw
        name: `mcp__${name}__${t.name}`,
      }));

      clients.set(name, { client, transport, tools });
      results.push({ name, tools });
      console.log(`[mcp] ✅ ${name}: ${tools.length} tools`);
    } catch (err) {
      console.error(`[mcp] ❌ ${name}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Panggil tool MCP dengan nama prefixed (mcp__server__tool).
 * @returns {Promise<any>} hasil tool
 */
export async function callMcpTool(prefixedName, args) {
  const m = /^mcp__(.+?)__(.+)$/.exec(prefixedName);
  if (!m) throw new Error(`Invalid MCP tool name: ${prefixedName}`);
  const [, serverName, toolName] = m;

  const entry = clients.get(serverName);
  if (!entry) throw new Error(`MCP server not running: ${serverName}`);

  const res = await entry.client.callTool({ name: toolName, arguments: args || {} });
  return res;
}

/**
 * Ambil semua tools dari semua MCP server, format siap daftar ke tool registry CodeClaw.
 */
export function getMcpTools() {
  const all = [];
  for (const [serverName, entry] of clients.entries()) {
    for (const t of entry.tools) {
      all.push({
        name: t.name,
        description: `[MCP:${serverName}] ${t.description || ""}`.trim(),
        inputSchema: t.inputSchema,
        handler: async (args) => callMcpTool(t.name, args),
      });
    }
  }
  return all;
}

/**
 * Shutdown semua MCP client (untuk graceful exit).
 */
export async function stopMcpServers() {
  for (const [name, entry] of clients.entries()) {
    try {
      await entry.transport.close();
      console.log(`[mcp] stopped ${name}`);
    } catch (e) {
      console.warn(`[mcp] close ${name} failed: ${e.message}`);
    }
  }
  clients.clear();
}
