import { afterAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server";
import { TEST_TOKEN, testConfig } from "./helpers";

const TOKEN = TEST_TOKEN;

const running = startServer(testConfig());
const base = `http://localhost:${running.port}`;

afterAll(() => running.stop());

function connect(token?: string): Promise<WebSocket> {
  // トークンは Authorization ヘッダーで渡す（クエリパラメータは廃止済み）
  const ws = new WebSocket(`ws://localhost:${running.port}/ws`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("connection failed"));
    ws.onclose = (e) => reject(new Error(`closed: ${e.code}`));
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
  });
}

describe("auth", () => {
  test("トークンなしの REST は 401", async () => {
    const res = await fetch(`${base}/events?after=0`);
    expect(res.status).toBe(401);
  });

  test("誤トークンの WS ハンドシェイクは拒否される", async () => {
    expect(connect("wrong-token-0123456789abcdef")).rejects.toThrow();
  });

  test("/health は無認証で 200", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });
});

describe("M1: メッセージの往復と catch-up", () => {
  test("user_message を送るとタイムライン同報とエコーが返る", async () => {
    const ws = await connect(TOKEN);
    const first = nextMessage(ws);
    ws.send(JSON.stringify({ type: "user_message", payload: { text: "hello" } }));

    // 1通目: 自分の発話がタイムラインイベントとして返る
    const userEvent = await first;
    expect(userEvent.type).toBe("user_message");
    expect((userEvent.payload as { text: string }).text).toBe("hello");

    // 2通目: エコー応答
    const echo = await nextMessage(ws);
    expect(echo.type).toBe("assistant_message");
    expect((echo.payload as { text: string }).text).toBe("echo: hello");
    expect(echo.id).toBeGreaterThan(userEvent.id as number);
    ws.close();
  });

  test("不正なフレームには一時 error が返り、永続化されない", async () => {
    const listEvents = async (): Promise<unknown[]> => {
      const body = (await (await fetch(`${base}/events?after=0`, auth())).json()) as {
        events: unknown[];
      };
      return body.events;
    };
    const before = await listEvents();
    const ws = await connect(TOKEN);
    const first = nextMessage(ws);
    ws.send("garbage");
    const err = await first;
    expect(err.type).toBe("error");
    expect(err.id).toBeUndefined();
    const after = await listEvents();
    expect(after.length).toBe(before.length);
    ws.close();
  });

  test("切断中に発生したイベントを catch-up で回収できる", async () => {
    // クライアント不在のままエージェント発の通知を発行（受信箱に永続化される）
    const offline = await running.dispatcher.emit("notification", { text: "while you were away" });

    // 「最後に受け取った id」以降を取り寄せる
    const res = await fetch(`${base}/events?after=${offline.id - 1}`, auth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: number; type: string }> };
    expect(body.events.map((e) => e.id)).toContain(offline.id);
    expect(body.events.at(-1)?.type).toBe("notification");
  });

  test("after が不正なら 400", async () => {
    const res = await fetch(`${base}/events?after=abc`, auth());
    expect(res.status).toBe(400);
  });
});

function auth(): RequestInit {
  return { headers: { authorization: `Bearer ${TOKEN}` } };
}
