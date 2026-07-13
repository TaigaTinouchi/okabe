import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(8787),
  authToken: z.string().min(16, "AUTH_TOKEN must be at least 16 characters"),
  dbPath: z.string().default("data/okabe.db"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = Bun.env): Config {
  return configSchema.parse({
    port: env.PORT,
    authToken: env.AUTH_TOKEN,
    dbPath: env.DB_PATH,
  });
}
