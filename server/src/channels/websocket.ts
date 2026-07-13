import type { WSContext } from "hono/ws";
import type { ServerEvent } from "../protocol";
import type { Channel } from "./channel";

/** 接続中の WebSocket 全てにイベントを配送するチャネル */
export class WebSocketChannel implements Channel {
  readonly name = "websocket";
  private readonly sockets = new Set<WSContext>();

  add(ws: WSContext): void {
    this.sockets.add(ws);
  }

  remove(ws: WSContext): void {
    this.sockets.delete(ws);
  }

  get connectionCount(): number {
    return this.sockets.size;
  }

  deliver(event: ServerEvent): void {
    const frame = JSON.stringify(event);
    for (const ws of this.sockets) {
      try {
        ws.send(frame);
      } catch (err) {
        // 切断競合等。イベントは永続化済みなので catch-up で回収される
        console.warn(`[ws] deliver failed: ${String(err)}`);
      }
    }
  }
}
