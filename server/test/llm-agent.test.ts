import { describe, expect, test } from "bun:test";
import { LlmAgent } from "../src/core/agent";
import type { ChatMessage, ChatOptions, LlmProvider, LlmStreamEvent } from "../src/llm/provider";
import { SkillRegistry } from "../src/skills/skill";
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
    yield {
      type: "message_end",
      text: full,
      stopReason: "end_turn",
      assistantContent: [{ type: "text", text: full }],
    };
  }
}

async function collect(agent: LlmAgent) {
  const out = [];
  for await (const ev of agent.respond("")) out.push(ev);
  return out;
}

describe("LlmAgent", () => {
  test("受信箱の会話履歴（通知含む）をそのまま文脈として渡す", async () => {
    const store = new EventStore(createDb(":memory:"));
    store.append("user_message", { text: "私の名前はたいがです" });
    store.append("assistant_message", { text: "はじめまして、たいがさん" });
    // 通知もエージェント発の発話として文脈に載る（M4-c: 「2件目の詳細教えて」が通じる）
    store.append("notification", { text: "今日の予定は2件です" });
    store.append("user_message", { text: "私の名前は？" });

    const provider = new FakeProvider(["たいが", "さんです"]);
    const events = await collect(new LlmAgent(provider, store));

    const call = provider.calls[0];
    expect(call?.messages).toEqual([
      { role: "user", content: "私の名前はたいがです" },
      { role: "assistant", content: "はじめまして、たいがさん" },
      { role: "assistant", content: "今日の予定は2件です" },
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

  test("履歴の先頭が assistant（通知等）の場合は捨てずに合成 user ターンを前置する", async () => {
    const store = new EventStore(createDb(":memory:"));
    store.append("notification", { text: "今日の予定は1件です: 13:30 休憩" });
    store.append("user_message", { text: "その予定の詳細教えて" });

    const provider = new FakeProvider(["はい"]);
    await collect(new LlmAgent(provider, store));

    const messages = provider.calls[0]?.messages;
    // 先頭は user（API制約を満たす）だが、通知は文脈に残っている
    expect(messages?.[0]?.role).toBe("user");
    expect(messages?.[1]).toEqual({
      role: "assistant",
      content: "今日の予定は1件です: 13:30 休憩",
    });
    expect(messages?.[2]).toEqual({ role: "user", content: "その予定の詳細教えて" });
  });

  test("historyLimit で渡す文脈の量を絞る", async () => {
    const store = new EventStore(createDb(":memory:"));
    for (let i = 1; i <= 10; i++) {
      store.append("user_message", { text: `メッセージ${i}` });
    }
    const provider = new FakeProvider(["ok"]);
    await collect(new LlmAgent(provider, store, new SkillRegistry([]), 3));

    expect(provider.calls[0]?.messages).toHaveLength(3);
    expect(provider.calls[0]?.messages.at(-1)?.content).toBe("メッセージ10");
  });
});
