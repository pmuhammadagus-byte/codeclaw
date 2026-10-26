import { z } from "zod";

export const ConfigSchema = z.object({
  gateway: z.object({
    mode: z.string().default("local"),
    httpPort: z.number().int().positive().default(3000),
  }).optional(),
  models: z.object({
    mode: z.string().optional(),
    default: z.string().optional(),
    providers: z.record(z.object({
      baseUrl: z.string().url(),
      apiKey: z.string().optional(),
      api: z.string().optional(),
      models: z.array(z.object({
        id: z.string(),
        name: z.string().optional(),
        maxTokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
      })).optional(),
      maxTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })).optional(),
  }).optional(),
  agents: z.object({
    main: z.object({
      default: z.boolean().optional(),
      model: z.string().optional(),
      systemPromptFile: z.string().optional(),
    }).optional(),
  }).optional(),
  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().optional(),
      accounts: z.record(z.object({
        botToken: z.string().optional(),
        allowedUserIds: z.array(z.number()).optional(),
        pollTimeout: z.number().int().positive().optional(),
        chatId: z.string().optional(),
      })).optional(),
    }).optional(),
  }).optional(),
  agent: z.object({
    maxToolIterations: z.number().int().positive().optional(),
    contextWindow: z.number().int().positive().optional(),
    approvalMode: z.string().optional(),
    brainLevel: z.string().optional(),
  }).optional(),
  web: z.object({ exaApiKey: z.string().optional() }).optional(),
  audio: z.object({ groqApiKey: z.string().optional() }).optional(),
  twelvedata: z.object({ apiKey: z.string().optional() }).optional(),
  research: z.object({
    enabled: z.boolean().optional(),
    topics: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
  }).optional(),
}).passthrough();

export function validateConfig(raw) {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Config invalid:\n${issues}`);
  }
  return result.data;
}
