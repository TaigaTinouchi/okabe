import type { Config } from "../src/config";

export const TEST_TOKEN = "test-token-0123456789abcdef";

/** テスト用 Config。スキーマにフィールドが増えてもここだけ直せばよい */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    bindHost: "127.0.0.1",
    authToken: TEST_TOKEN,
    dbPath: ":memory:",
    anthropicModel: "unused",
    anthropicModelLight: "unused",
    disabledJobs: "",
    morningSummaryCron: "30 7 * * *",
    googleCalendarId: "primary",
    ...overrides,
  };
}
