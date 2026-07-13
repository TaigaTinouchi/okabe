import { describe, expect, test } from "bun:test";
import { LlmAgent } from "../src/core/agent";
import type { ChatMessage, ChatOptions, LlmProvider, LlmStreamEvent } from "../src/llm/provider";
import { createDb } from "../src/store/db";
import { EventStore } from "../src/store/events";

class FakeProvider implements LlmProvider {
  calls: Array<{ messages: ChatMessage[]; opts?: ChatOptions }> = [];

  constructor(private readonly script: string[]) {}

  async *chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<LlmStreamEvent> {
    this.calls.push({ messages, opts });
    let full = "";
    for (const text of this.script) {
      full += text;
      yield { type: "text_delta", text };
    }
    yield { type: "message_end", text: full };
  }
}

async function collect(agent: LlmAgent) {
  const out = [];
  for await (const ev of agent.respond("")) out.push(ev);
  return out;
}

describe("LlmAgent", () => {
  test("受信箱の会話履歴をそのまま文脈として渡す", async () => {
    const store = new EventStore(createDb(":memory:"));
    store.append("user_message", { text: "私の名前はたいがです" });
    store.append("assistant_message", { text: "はじめまして、たいがさん" });
    store.append("notification", { text: "（通知は履歴に含めない）" });
    store.append("user_message", { text: "私の名前は？" });

    const provider = new FakeProvider(["たいが", "さんです"]);
    const events = await collect(new LlmAgent(provider, store));

    const call = provider.calls[0];
    expect(call?.messages).toEqual([
      { role: "user", content: "私の名前はたいがです" },
      { role: "assistant", content: "はじめまして、たいがさん" },
      { role: "user", content: "私の名前は？" },
    ]);
    expect(call?.opts?.system).toContain("okabe");

    expect(events).toEqual([
      { kind: "delta", text: "たいが" },
      { kind: "delta", text: "さんです" },
      {
        kind: "message",
        type: "assistant_message",
        payload: { text: "たいがさんです" },
      },
    ]);
  });

  test("履歴の先頭が assistant の場合は user から始まるよう切り詰める", async () => {
    const store = new EventStore(createDb(":memory:"));
    store.append("assistant_message", { text: "（履歴の切れ目）" });
    store.append("user_message", { text: "こんにちは" });

    const provider = new FakeProvider(["やあ"]);
    await collect(new LlmAgent(provider, store));

    expect(provider.calls[0]?.messages[0]).toEqual({ role: "user", content: "こんにちは" });
  });

  test("historyLimit で渡す文脈の量を絞る", async () => {
    const store = new EventStore(createDb(":memory:"));
    for (let i = 1; i <= 10; i++) {
      store.append("user_message", { text: `メッセージ${i}` });
    }
    const provider = new FakeProvider(["ok"]);
    await collect(new LlmAgent(provider, store, 3));

    expect(provider.calls[0]?.messages).toHaveLength(3);
    expect(provider.calls[0]?.messages.at(-1)?.content).toBe("メッセージ10");
  });
});
