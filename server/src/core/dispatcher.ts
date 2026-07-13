import type { Channel } from "../channels/channel";
import type { EventType, ServerEvent } from "../protocol";
import type { EventStore } from "../store/events";

/**
 * 「先に永続化、配送はその後」を強制する唯一の出口（ADR-0003）。
 * エージェント応答も能動通知も、クライアントへ向かうものは全てここを通る。
 */
export class Dispatcher {
  private readonly channels: Channel[] = [];

  constructor(private readonly store: EventStore) {}

  register(channel: Channel): void {
    this.channels.push(channel);
  }

  async emit(type: EventType, payload: { text: string }): Promise<ServerEvent> {
    const event = this.store.append(type, payload);
    for (const channel of this.channels) {
      try {
        await channel.deliver(event);
      } catch (err) {
        console.warn(`[dispatcher] channel "${channel.name}" failed: ${String(err)}`);
      }
    }
    return event;
  }
}
