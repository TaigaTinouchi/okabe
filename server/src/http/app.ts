import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { z } from "zod";
import type { WebSocketChannel } from "../channels/websocket";
import type { Agent } from "../core/agent";
import type { Dispatcher } from "../core/dispatcher";
import { parseClientMessage, type TransientError } from "../protocol";
import type { EventStore } from "../store/events";
import type { ReadStateStore } from "../store/read-state";
import { bearerAuth } from "./auth";

export interface AppDeps {
  authToken: string;
  store: EventStore;
  readState: ReadStateStore;
  dispatcher: Dispatcher;
  agent: Agent;
  wsChannel: WebSocketChannel;
  upgradeWebSocket: UpgradeWebSocket;
}

const readCursorSchema = z.object({ lastEventId: z.number().int().positive() });

export function createApp(deps: AppDeps) {
  const { authToken, store, readState, dispatcher, agent, wsChannel, upgradeWebSocket } = deps;
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  const auth = bearerAuth(authToken);

  // catch-up: 最終受信 id 以降のイベントを昇順で返す（ADR-0003）
  app.get("/events", auth, (c) => {
    const after = Number(c.req.query("after") ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return c.json({ error: "after must be a non-negative integer" }, 400);
    }
    return c.json({ events: store.listAfter(after) });
  });

  // 既読カーソル（M4-b）。クライアントが表示済みの最終イベント id を申告する
  app.post("/read-cursor", auth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = readCursorSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "lastEventId must be a positive integer" }, 400);
    }
    return c.json({ lastReadEventId: readState.advance(parsed.data.lastEventId) });
  });

  // 未読通知の取得（M4-b）。接続時のバッジ表示や将来のプッシュ起点に使う
  app.get("/notifications/unread", auth, (c) => {
    const cursor = readState.get();
    return c.json({
      lastReadEventId: cursor,
      notifications: store.listNotificationsAfter(cursor),
    });
  });

  app.get(
    "/ws",
    auth,
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        wsChannel.add(ws);
      },
      onClose(_evt, ws) {
        wsChannel.remove(ws);
      },
      async onMessage(evt, ws) {
        const message = parseClientMessage(String(evt.data));
        if (!message) {
          const error: TransientError = {
            type: "error",
            payload: { message: "invalid message" },
          };
          ws.send(JSON.stringify(error));
          return;
        }
        // ユーザー発話もタイムラインの一部として受信箱に載せる（全クライアントに同報）
        await dispatcher.emit("user_message", message.payload);
        try {
          for await (const reply of agent.respond(message.payload.text)) {
            if (reply.kind === "delta") {
              // 断片は永続化しない。全文は最後に assistant_message として受信箱に載る
              wsChannel.broadcastTransient({
                type: "assistant_delta",
                payload: { text: reply.text },
              });
            } else {
              await dispatcher.emit(reply.type, reply.payload);
            }
          }
        } catch (err) {
          console.error(`[agent] respond failed: ${String(err)}`);
          wsChannel.broadcastTransient({
            type: "error",
            payload: { message: "応答の生成に失敗しました。しばらくして再送してください。" },
          });
        }
      },
    })),
  );

  return app;
}
