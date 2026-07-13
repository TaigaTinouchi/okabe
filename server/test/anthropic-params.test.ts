import { describe, expect, test } from "bun:test";
import { buildRequestParams } from "../src/llm/anthropic";

describe("buildRequestParams（プロンプトキャッシング）", () => {
  test("system 末尾と最終メッセージ末尾に cache_control が付く", () => {
    const params = buildRequestParams({
      model: "claude-opus-4-8",
      maxTokens: 100,
      system: "システムプロンプト",
      messages: [
        { role: "user", content: "一つ目" },
        { role: "assistant", content: "応答" },
        { role: "user", content: "二つ目" },
      ],
    });

    // system: 単一ブロック + cache_control（breakpoint 1）
    expect(params.system).toEqual([
      {
        type: "text",
        text: "システムプロンプト",
        cache_control: { type: "ephemeral" },
      },
    ]);

    // 途中のメッセージは素の文字列のまま（キャッシュ境界を作らない）
    expect(params.messages[0]).toEqual({ role: "user", content: "一つ目" });
    expect(params.messages[1]).toEqual({ role: "assistant", content: "応答" });

    // 最終メッセージだけブロック化して cache_control（breakpoint 2）
    expect(params.messages[2]).toEqual({
      role: "user",
      content: [{ type: "text", text: "二つ目", cache_control: { type: "ephemeral" } }],
    });
  });

  test("system なしでも壊れない", () => {
    const params = buildRequestParams({
      model: "m",
      maxTokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(params.system).toBeUndefined();
    expect(params.messages).toHaveLength(1);
  });
});
