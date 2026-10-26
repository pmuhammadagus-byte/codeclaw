import { z } from "zod";

export const ConfigSchema = z.object({
  // === LLM ===
  llm: z.object({
    modelRef: z.string().min(1, "llm.modelRef wajib diisi"),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
  }).passthrough().optional(),

  // === Telegram (top-level, dipakai panel) ===
  telegram: z.object({
    enabled: z.boolean().optional(),
    botToken: z.string().optional(),
    allowedUserIds: z.array(z.number().int()).optional(),
    chatId: z.string().optional(),
  }).passthrough().optional(),

  // === Agent ===
  agent: z.object({
    maxToolIterations: z.number().int().positive().optional(),
    approvalMode: z.string().optional(),
    brainLevel: z.string().optional(),
    contextWindow: z.number().int().positive().optional(),
  }).passthrough().optional(),

  // === Raw: sumber mentah config.json ===
  raw: z.object({
    web: z.object({
      exaApiKey: z.string().optional(),
    }).passthrough().optional(),

    audio: z.object({
      groqApiKey: z.string().optional(),
    }).passthrough().optional(),

    twelvedata: z.object({
      apiKey: z.string().optional(),
    }).passthrough().optional(),

    models: z.object({
      providers: z.record(
        z.string(),
        z.object({
          baseUrl: z.string().url("baseUrl harus URL valid"),
          apiKey: z.string().min(1, "apiKey wajib diisi").optional(),
          api: z.string().optional(),
          models: z.array(
            z.object({
              id: z.string().min(1),
              name: z.string().optional(),
            }).passthrough()
          ).optional(),
        }).passthrough()
      ).optional(),
    }).passthrough().optional(),

    channels: z.object({
      telegram: z.object({
        enabled: z.boolean().optional(),
        accounts: z.record(
          z.string(),
          z.object({
            botToken: z.string().optional(),
            allowedUserIds: z.array(z.number().int()).optional(),
            chatId: z.string().optional(),
          }).passthrough()
        ).optional(),
      }).passthrough().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();  // field lain tetap lolos

export function validateConfig(raw) {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Config invalid:\n${issues}`);
  }
  return result.data;
}
