import type { WSContext } from "hono/ws";
import type { ServerEvent, TransientDelta, TransientError } from "../protocol";
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
    this.broadcast(event);
  }

  /** 永続化しない一時フレーム（delta / error）の同報。失われても catch-up で全文が届く */
  broadcastTransient(frame: TransientDelta | TransientError): void {
    this.broadcast(frame);
  }

  private broadcast(payload: object): void {
    const frame = JSON.stringify(payload);
    for (const ws of this.sockets) {
      try {
        ws.send(frame);
      } catch (err) {
        // 切断競合等。永続イベントは catch-up で回収される
        console.warn(`[ws] send failed: ${String(err)}`);
      }
    }
  }
}
