import { afterAll, describe, expect, test } from "bun:test";
import type { Agent, AgentEvent } from "../src/core/agent";
import { startServer } from "../src/server";

const TOKEN = "test-token-0123456789abcdef";

/** delta → delta → 確定、の順で応答するスタブ（M2 のストリーミング配送を検証） */
const streamingStub: Agent = {
  async *respond(): AsyncIterable<AgentEvent> {
    yield { kind: "delta", text: "こん" };
    yield { kind: "delta", text: "にちは" };
    yield { kind: "message", type: "assistant_message", payload: { text: "こんにちは" } };
  },
};

const running = startServer(
  {
    port: 0,
    authToken: TOKEN,
    dbPath: ":memory:",
    anthropicModel: "unused",
    anthropicModelLight: "unused",
    disabledJobs: "",
    morningSummaryCron: "30 7 * * *",
    googleCalendarId: "primary",
  },
  { agent: streamingStub },
);
const base = `http://localhost:${running.port}`;

afterAll(() => running.stop());

describe("M2: assistant_delta のストリーミング配送", () => {
  test("delta は一時フレームで届き、確定文だけが受信箱に永続化される", async () => {
    const ws = new WebSocket(`ws://localhost:${running.port}/ws`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const frames: Record<string, unknown>[] = [];
    const done = new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const frame = JSON.parse(String(e.data));
        frames.push(frame);
        if (frame.type === "assistant_message") resolve();
      };
    });
    await new Promise((resolve) => {
      ws.onopen = resolve;
    });
    ws.send(JSON.stringify({ type: "user_message", payload: { text: "やあ" } }));
    await done;
    ws.close();

    expect(frames.map((f) => f.type)).toEqual([
      "user_message",
      "assistant_delta",
      "assistant_delta",
      "assistant_message",
    ]);
    // delta は id を持たない（永続化されない）
    expect(frames[1]?.id).toBeUndefined();
    expect(frames[2]?.id).toBeUndefined();
    // delta を連結すると確定文になる
    expect((frames[3] as { payload: { text: string } }).payload.text).toBe("こんにちは");

    // 受信箱には user_message と assistant_message の2件だけ
    const res = await fetch(`${base}/events?after=0`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = (await res.json()) as { events: Array<{ type: string }> };
    expect(body.events.map((e) => e.type)).toEqual(["user_message", "assistant_message"]);
  });
});
