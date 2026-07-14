import { createBunWebSocket } from "hono/bun";
import { WebSocketChannel } from "./channels/websocket";
import type { Config } from "./config";
import { type Agent, EchoAgent, LlmAgent } from "./core/agent";
import { Dispatcher } from "./core/dispatcher";
import { createApp } from "./http/app";
import { type JobContext, JobScheduler } from "./jobs/scheduler";
import { AnthropicProvider } from "./llm/anthropic";
import type { LlmProvider } from "./llm/provider";
import { CalendarSkill } from "./skills/calendar";
import { GoogleCalendarClient } from "./skills/calendar/google-client";
import { type Skill, SkillRegistry } from "./skills/skill";
import { createDb } from "./store/db";
import { EventStore } from "./store/events";
import { JobRunStore } from "./store/job-runs";
import { ReadStateStore } from "./store/read-state";

export interface RunningServer {
  port: number;
  dispatcher: Dispatcher;
  scheduler: JobScheduler;
  stop(): void;
}

/** 全部品を配線してサーバーを起動する。テストからも同じ経路で起動する */
export function startServer(config: Config, overrides: { agent?: Agent } = {}): RunningServer {
  const db = createDb(config.dbPath);
  const store = new EventStore(db);
  const readState = new ReadStateStore(db);
  const dispatcher = new Dispatcher(store);
  const wsChannel = new WebSocketChannel();
  dispatcher.register(wsChannel);

  const provider = config.anthropicApiKey
    ? new AnthropicProvider({
        apiKey: config.anthropicApiKey,
        model: config.anthropicModel,
        lightModel: config.anthropicModelLight,
      })
    : undefined;
  const skills = createSkills(config);
  const registry = new SkillRegistry(skills);

  const agent = overrides.agent ?? createDefaultAgent(config, store, provider, registry);

  // ジョブスケジューラ（M4-a）。スキルが持つ定期ジョブを起動時に再登録する
  const scheduler = new JobScheduler({
    runStore: new JobRunStore(db),
    disabledJobs: new Set(
      config.disabledJobs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    ctx: createJobContext(dispatcher, provider),
  });
  for (const skill of skills) {
    for (const job of skill.jobs ?? []) scheduler.register(job);
  }

  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = createApp({
    authToken: config.authToken,
    store,
    readState,
    dispatcher,
    agent,
    wsChannel,
    upgradeWebSocket,
  });

  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    websocket,
  });

  const port = server.port;
  if (port === undefined) throw new Error("server did not bind to a TCP port");

  console.log(`[okabe] listening on :${port} (db: ${config.dbPath})`);
  return {
    port,
    dispatcher,
    scheduler,
    stop: () => {
      scheduler.stop();
      server.stop(true);
    },
  };
}

/** ジョブに渡す実行コンテキスト。通知の発行と、軽量モデルでのテキスト生成 */
function createJobContext(dispatcher: Dispatcher, provider: LlmProvider | undefined): JobContext {
  return {
    notify: async (text) => {
      await dispatcher.emit("notification", { text });
    },
    complete: async (prompt) => {
      if (!provider) throw new Error("ANTHROPIC_API_KEY 未設定のため complete は使えません");
      let text = "";
      for await (const ev of provider.chat([{ role: "user", content: prompt }], {
        tier: "light",
      })) {
        if (ev.type === "message_end") text = ev.text;
      }
      return text;
    },
  };
}

function createDefaultAgent(
  config: Config,
  store: EventStore,
  provider: LlmProvider | undefined,
  registry: SkillRegistry,
): Agent {
  if (!provider) {
    console.warn("[okabe] ANTHROPIC_API_KEY 未設定のためエコー応答で起動します");
    return new EchoAgent();
  }
  console.log(
    `[okabe] LLM: ${config.anthropicModel} (light: ${config.anthropicModelLight}) / skills: ${registry.isEmpty ? "なし" : registry.tools.map((t) => t.name).join(", ")}`,
  );
  return new LlmAgent(provider, store, registry);
}

function createSkills(config: Config): Skill[] {
  const skills: Skill[] = [];
  if (config.googleClientId && config.googleClientSecret && config.googleRefreshToken) {
    skills.push(
      new CalendarSkill(
        new GoogleCalendarClient({
          clientId: config.googleClientId,
          clientSecret: config.googleClientSecret,
          refreshToken: config.googleRefreshToken,
          calendarId: config.googleCalendarId,
        }),
        { morningSummaryCron: config.morningSummaryCron },
      ),
    );
  } else {
    console.warn("[okabe] GOOGLE_* 未設定のため calendar スキルは無効です（手順は README）");
  }
  return skills;
}
