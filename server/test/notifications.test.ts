import { afterAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server";

const TOKEN = "test-token-0123456789abcdef";

const running = startServer({
  port: 0,
  authToken: TOKEN,
  dbPath: ":memory:",
  anthropicModel: "unused",
  anthropicModelLight: "unused",
  disabledJobs: "",
  morningSummaryCron: "30 7 * * *",
  googleCalendarId: "primary",
});
const base = `http://localhost:${running.port}`;
const auth = { authorization: `Bearer ${TOKEN}` };

afterAll(() => running.stop());

describe("M4-b: 通知の既読/未読管理", () => {
  test("未読通知の保存 → 接続時取得 → 既読化の一連の流れ", async () => {
    // エージェント発の通知を2件発行（クライアント不在でも受信箱に残る）
    const n1 = await running.dispatcher.emit("notification", { text: "通知その1" });
    const n2 = await running.dispatcher.emit("notification", { text: "通知その2" });
    // 通知以外のイベントは未読通知には含まれない
    await running.dispatcher.emit("assistant_message", { text: "通常の応答" });

    // 未読一覧に2件
    let res = await fetch(`${base}/notifications/unread`, { headers: auth });
    let body = (await res.json()) as {
      lastReadEventId: number;
      notifications: Array<{ id: number; payload: { text: string } }>;
    };
    expect(body.lastReadEventId).toBe(0);
    expect(body.notifications.map((n) => n.payload.text)).toEqual(["通知その1", "通知その2"]);

    // 1件目まで既読化 → 未読は2件目だけ
    await fetch(`${base}/read-cursor`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ lastEventId: n1.id }),
    });
    res = await fetch(`${base}/notifications/unread`, { headers: auth });
    body = (await res.json()) as typeof body;
    expect(body.lastReadEventId).toBe(n1.id);
    expect(body.notifications.map((n) => n.id)).toEqual([n2.id]);

    // 全部既読化 → 未読ゼロ
    await fetch(`${base}/read-cursor`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ lastEventId: n2.id + 1 }),
    });
    res = await fetch(`${base}/notifications/unread`, { headers: auth });
    body = (await res.json()) as typeof body;
    expect(body.notifications).toHaveLength(0);
  });

  test("既読カーソルは巻き戻らない（単調増加）", async () => {
    const res = await fetch(`${base}/read-cursor`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ lastEventId: 1 }),
    });
    const body = (await res.json()) as { lastReadEventId: number };
    // 直前のテストで進めたカーソルより小さい値を送っても現状維持
    expect(body.lastReadEventId).toBeGreaterThan(1);
  });

  test("不正なボディは 400、未認証は 401", async () => {
    const bad = await fetch(`${base}/read-cursor`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ lastEventId: "abc" }),
    });
    expect(bad.status).toBe(400);

    const noAuth = await fetch(`${base}/notifications/unread`);
    expect(noAuth.status).toBe(401);
  });
});
