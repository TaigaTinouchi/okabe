import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(8787),
  authToken: z.string().min(16, "AUTH_TOKEN must be at least 16 characters"),
  dbPath: z.string().default("data/okabe.db"),
  /** 未設定なら LLM を使わずエコー応答（M1 相当）で起動する */
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().default("claude-opus-4-8"),
  /** 3つ揃って初めて calendar スキルが有効になる（取得手順は README） */
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
  googleRefreshToken: z.string().optional(),
  googleCalendarId: z.string().default("primary"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = Bun.env): Config {
  return configSchema.parse({
    port: env.PORT,
    authToken: env.AUTH_TOKEN,
    dbPath: env.DB_PATH,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleRefreshToken: env.GOOGLE_REFRESH_TOKEN,
    googleCalendarId: env.GOOGLE_CALENDAR_ID,
  });
}
