import { createBunWebSocket } from "hono/bun";
import { WebSocketChannel } from "./channels/websocket";
import type { Config } from "./config";
import { type Agent, EchoAgent, LlmAgent } from "./core/agent";
import { Dispatcher } from "./core/dispatcher";
import { createApp } from "./http/app";
import { AnthropicProvider } from "./llm/anthropic";
import { createDb } from "./store/db";
import { EventStore } from "./store/events";

export interface RunningServer {
  port: number;
  dispatcher: Dispatcher;
  stop(): void;
}

/** 全部品を配線してサーバーを起動する。テストからも同じ経路で起動する */
export function startServer(config: Config, overrides: { agent?: Agent } = {}): RunningServer {
  const db = createDb(config.dbPath);
  const store = new EventStore(db);
  const dispatcher = new Dispatcher(store);
  const wsChannel = new WebSocketChannel();
  dispatcher.register(wsChannel);

  const agent = overrides.agent ?? createDefaultAgent(config, store);
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const app = createApp({
    authToken: config.authToken,
    store,
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
    stop: () => server.stop(true),
  };
}

function createDefaultAgent(config: Config, store: EventStore): Agent {
  if (!config.anthropicApiKey) {
    console.warn("[okabe] ANTHROPIC_API_KEY 未設定のためエコー応答で起動します");
    return new EchoAgent();
  }
  console.log(`[okabe] LLM: ${config.anthropicModel}`);
  return new LlmAgent(
    new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.anthropicModel }),
    store,
  );
}
