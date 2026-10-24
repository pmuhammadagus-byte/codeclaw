import fs from "node:fs";

export function parseModelRef(ref) {
  if (!ref) return { provider: null, model: null };
  const idx = ref.indexOf("/");
  if (idx === -1) return { provider: null, model: ref };
  return { provider: ref.slice(0, idx), model: ref.slice(idx + 1) };
}

export function loadConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // --- Resolve active model ---
  const activeRef =
    raw.agents?.main?.model ??
    raw.agents?.[Object.keys(raw.agents || {})[0]]?.model ??
    raw.models?.default ??
    (raw.llm ? (raw.llm.provider ? `${raw.llm.provider}/${raw.llm.model}` : raw.llm.model) : null);

  let llm;
  let providers = {};

  if (raw.models?.providers && Object.keys(raw.models.providers).length > 0) {
    // New format
    providers = raw.models.providers;
    const { provider, model } = parseModelRef(activeRef);
    const providerId = provider || Object.keys(providers)[0];
    const p = providers[providerId];
    if (!p) throw new Error(`Provider "${providerId}" tidak ditemukan di models.providers`);
    const modelId = model || p.models?.[0]?.id;
    const modelMeta = p.models?.find(m => m.id === modelId) || p.models?.[0] || {};
    llm = {
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: modelId,
      maxTokens: modelMeta.maxTokens ?? p.maxTokens ?? 8192,
      temperature: modelMeta.temperature ?? p.temperature ?? 0.2,
      providerId,
      modelRef: `${providerId}/${modelId}`,
    };
  } else if (raw.llm) {
    // Backward compat: old format
    llm = {
      baseUrl: raw.llm.baseUrl,
      apiKey: raw.llm.apiKey,
      model: raw.llm.model,
      maxTokens: raw.llm.maxTokens ?? 8192,
      temperature: raw.llm.temperature ?? 0.2,
      providerId: raw.llm.provider || "default",
      modelRef: `${raw.llm.provider || "default"}/${raw.llm.model}`,
    };
  } else {
    throw new Error("Config tidak punya models.providers atau llm");
  }

  // --- Telegram ---
  let telegram;
  if (raw.channels?.telegram) {
    const t = raw.channels.telegram;
    const accounts = t.accounts || {};
    const defaultId = Object.keys(accounts)[0] || "default";
    const acc = accounts[defaultId] || {};
    telegram = {
      enabled: t.enabled ?? false,
      botToken: acc.botToken ?? "",
      allowedUserIds: (acc.allowedUserIds ?? []).map(Number),
      pollTimeout: acc.pollTimeout ?? 30,
      accountId: defaultId,
      accounts,
    };
  } else if (raw.telegram) {
    // Backward compat
    telegram = {
      enabled: raw.telegram.enabled ?? false,
      botToken: raw.telegram.botToken ?? "",
      allowedUserIds: (raw.telegram.allowedUserIds ?? []).map(Number),
      pollTimeout: 30,
      accountId: "default",
      accounts: { default: raw.telegram },
    };
  } else {
    telegram = { enabled: false, botToken: "", allowedUserIds: [], accounts: {} };
  }

  // --- Agent ---
  const agent = {
    maxToolIterations: raw.agent?.maxToolIterations ?? 30,
    contextWindow: raw.agent?.contextWindow ?? 80,
    approvalMode: raw.agent?.approvalMode ?? "dangerous-only",
    maxSubagentDepth: raw.agent?.maxSubagentDepth ?? 2,
    maxSubagentIterations: raw.agent?.maxSubagentIterations ?? 15,
  };

  return { raw, llm, telegram, agent, providers, configPath };
}

export function saveConfig(cfg, configPath) {
  fs.writeFileSync(configPath, JSON.stringify(cfg.raw, null, 2));
}

// Helper untuk CLI: list semua model
export function listModels(cfg) {
  const out = [];
  for (const [pid, p] of Object.entries(cfg.providers || {})) {
    for (const m of p.models || [{ id: "default" }]) {
      const ref = `${pid}/${m.id}`;
      out.push({ ref, providerId: pid, modelId: m.id, name: m.name || m.id, active: ref === cfg.llm.modelRef });
    }
  }
  return out;
}

// Helper untuk CLI: set active model
export function setActiveModel(cfg, ref, configPath) {
  const { provider, model } = parseModelRef(ref);
  if (provider && !cfg.providers[provider]) {
    throw new Error(`Provider "${provider}" tidak ada. Pilihan: ${Object.keys(cfg.providers).join(", ")}`);
  }

  // === SINKRON: ubah SEMUA field model sekaligus ===
  cfg.raw.agents = cfg.raw.agents || {};
  cfg.raw.agents.main = cfg.raw.agents.main || { default: true };
  cfg.raw.agents.main.model = ref;       // ← yang bot baca
  cfg.raw.models = cfg.raw.models || {};
  cfg.raw.models.default = ref;          // ← untuk display & fallback

  // === NORMALISASI: localhost → 127.0.0.1 ===
  for (const [pid, prov] of Object.entries(cfg.raw.models?.providers || {})) {
    const url = prov.baseUrl || "";
    if (url.includes("localhost")) {
      prov.baseUrl = url.replace(/localhost/g, "127.0.0.1");
    }
  }

  saveConfig(cfg, configPath);
}

// Helper untuk CLI: migrate old format → new format
export function migrateIfNeeded(cfg, configPath) {
  if (cfg.raw.models?.providers) return false; // already new
  if (!cfg.raw.llm) return false;

  const old = cfg.raw.llm;
  const newCfg = {
    gateway: cfg.raw.gateway || { mode: "local", httpPort: 3000 },
    models: {
      mode: "merge",
      default: `custom/${old.model}`,
      providers: {
        custom: {
          baseUrl: old.baseUrl,
          apiKey: old.apiKey,
          api: "openai-completions",
          models: [{ id: old.model, name: old.model, maxTokens: old.maxTokens ?? 8192, temperature: old.temperature ?? 0.2 }],
        },
      },
    },
    agents: { main: { default: true, model: `custom/${old.model}`, systemPromptFile: "system.md" } },
    channels: {
      telegram: {
        enabled: cfg.raw.telegram?.enabled ?? false,
        accounts: {
          default: {
            botToken: cfg.raw.telegram?.botToken ?? "",
            allowedUserIds: cfg.raw.telegram?.allowedUserIds ?? [],
            pollTimeout: 30,
          },
        },
      },
    },
    agent: cfg.raw.agent || {},
  };

  fs.writeFileSync(configPath, JSON.stringify(newCfg, null, 2));
  return true;
}
