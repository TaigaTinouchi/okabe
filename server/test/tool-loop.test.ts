import { describe, expect, test } from "bun:test";
import { type AgentEvent, LlmAgent } from "../src/core/agent";
import type { ChatMessage, ChatOptions, LlmProvider, LlmStreamEvent } from "../src/llm/provider";
import { type Skill, SkillRegistry } from "../src/skills/skill";
import { createDb } from "../src/store/db";
import { EventStore } from "../src/store/events";

/** 呼び出しごとに事前に用意した応答を返すプロバイダー */
class ScriptedProvider implements LlmProvider {
  calls: Array<{ messages: ChatMessage[]; opts?: ChatOptions }> = [];
  private turn = 0;

  constructor(private readonly script: LlmStreamEvent[][]) {}

  async *chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<LlmStreamEvent> {
    // メッセージ配列はループ中に破壊されるためスナップショットを保存
    this.calls.push({ messages: structuredClone(messages), opts });
    const events = this.script[this.turn++];
    if (!events) throw new Error("script exhausted");
    yield* events;
  }
}

class FakeCalendarSkill implements Skill {
  name = "calendar";
  executed: Array<{ tool: string; input: unknown }> = [];
  tools = [
    {
      name: "list_events",
      description: "予定を取得する",
      inputSchema: { type: "object", properties: {} },
    },
  ];

  async execute(toolName: string, input: unknown): Promise<string> {
    this.executed.push({ tool: toolName, input });
    return JSON.stringify({ events: [{ summary: "歯医者", start: "2026-07-14T10:00:00+09:00" }] });
  }
}

async function collect(agent: LlmAgent): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of agent.respond("")) out.push(ev);
  return out;
}

function makeStore() {
  const store = new EventStore(createDb(":memory:"));
  store.append("user_message", { text: "明日の予定は？" });
  return store;
}

describe("LlmAgent ツールループ", () => {
  test("tool_use → スキル実行 → tool_result 返送 → 確定応答", async () => {
    const skill = new FakeCalendarSkill();
    const provider = new ScriptedProvider([
      // 1往復目: モデルがツールを要求
      [
        {
          type: "message_end",
          text: "",
          stopReason: "tool_use",
          assistantContent: [
            { type: "provider_raw", raw: { type: "thinking", thinking: "", signature: "sig" } },
            { type: "tool_use", id: "tu_1", name: "list_events", input: { date: "2026-07-14" } },
          ],
        },
      ],
      // 2往復目: ツール結果を踏まえた最終応答
      [
        { type: "text_delta", text: "明日は" },
        { type: "text_delta", text: "歯医者があります" },
        {
          type: "message_end",
          text: "明日は歯医者があります",
          stopReason: "end_turn",
          assistantContent: [{ type: "text", text: "明日は歯医者があります" }],
        },
      ],
    ]);

    const agent = new LlmAgent(provider, makeStore(), new SkillRegistry([skill]));
    const events = await collect(agent);

    // スキルが正しい入力で実行された
    expect(skill.executed).toEqual([{ tool: "list_events", input: { date: "2026-07-14" } }]);

    // 2回目の呼び出しには assistant ブロック（thinking含む・無改変）と tool_result が積まれている
    const second = provider.calls[1]?.messages;
    expect(second?.at(-2)).toEqual({
      role: "assistant",
      content: [
        { type: "provider_raw", raw: { type: "thinking", thinking: "", signature: "sig" } },
        { type: "tool_use", id: "tu_1", name: "list_events", input: { date: "2026-07-14" } },
      ],
    });
    expect(second?.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", toolUseId: "tu_1" }],
    });

    // ツール定義がプロバイダーに渡っている
    expect(provider.calls[0]?.opts?.tools?.map((t) => t.name)).toEqual(["list_events"]);

    // クライアントには delta ×2 と確定メッセージが流れる
    expect(events).toEqual([
      { kind: "delta", text: "明日は" },
      { kind: "delta", text: "歯医者があります" },
      {
        kind: "message",
        type: "assistant_message",
        payload: { text: "明日は歯医者があります" },
      },
    ]);
  });

  test("スキルが例外を投げたら is_error の tool_result として返送し会話は続く", async () => {
    const failing: Skill = {
      name: "broken",
      tools: [{ name: "boom", description: "x", inputSchema: { type: "object" } }],
      execute: async () => {
        throw new Error("接続失敗");
      },
    };
    const provider = new ScriptedProvider([
      [
        {
          type: "message_end",
          text: "",
          stopReason: "tool_use",
          assistantContent: [{ type: "tool_use", id: "tu_1", name: "boom", input: {} }],
        },
      ],
      [
        {
          type: "message_end",
          text: "確認できませんでした",
          stopReason: "end_turn",
          assistantContent: [{ type: "text", text: "確認できませんでした" }],
        },
      ],
    ]);

    const agent = new LlmAgent(provider, makeStore(), new SkillRegistry([failing]));
    const events = await collect(agent);

    expect(provider.calls[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "tool_result", toolUseId: "tu_1", isError: true }],
    });
    expect(events.at(-1)).toMatchObject({
      kind: "message",
      payload: { text: "確認できませんでした" },
    });
  });

  test("tool_use が続いても上限で打ち切る", async () => {
    const skill = new FakeCalendarSkill();
    const loopTurn: LlmStreamEvent[] = [
      {
        type: "message_end",
        text: "",
        stopReason: "tool_use",
        assistantContent: [{ type: "tool_use", id: "tu", name: "list_events", input: {} }],
      },
    ];
    const provider = new ScriptedProvider(Array(10).fill(loopTurn));
    const agent = new LlmAgent(provider, makeStore(), new SkillRegistry([skill]));
    const events = await collect(agent);

    expect(provider.calls).toHaveLength(5); // MAX_TOOL_ITERATIONS
    expect(events.at(-1)).toMatchObject({
      kind: "message",
      payload: { text: expect.stringContaining("上限") },
    });
  });

  test("ツールなしなら従来どおり1往復で応答（フォールバック）", async () => {
    const provider = new ScriptedProvider([
      [
        { type: "text_delta", text: "こんにちは" },
        {
          type: "message_end",
          text: "こんにちは",
          stopReason: "end_turn",
          assistantContent: [{ type: "text", text: "こんにちは" }],
        },
      ],
    ]);
    const agent = new LlmAgent(provider, makeStore());
    const events = await collect(agent);

    expect(provider.calls[0]?.opts?.tools).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ payload: { text: "こんにちは" } });
  });
});
