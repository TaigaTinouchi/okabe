import { asc, gt } from "drizzle-orm";
import type { EventType, ServerEvent } from "../protocol";
import type { Db } from "./db";
import { events } from "./schema";

/** イベント受信箱への追記と catch-up 読み出し。SQL はこのモジュールに閉じる */
export class EventStore {
  constructor(private readonly db: Db) {}

  append(type: EventType, payload: { text: string }): ServerEvent {
    const row = this.db.insert(events).values({ type, payload }).returning().get();
    return toServerEvent(row);
  }

  /** id が after より大きいイベントを昇順で返す */
  listAfter(after: number, limit = 500): ServerEvent[] {
    return this.db
      .select()
      .from(events)
      .where(gt(events.id, after))
      .orderBy(asc(events.id))
      .limit(limit)
      .all()
      .map(toServerEvent);
  }
}

function toServerEvent(row: typeof events.$inferSelect): ServerEvent {
  return {
    id: row.id,
    type: row.type as EventType,
    ts: row.createdAt,
    payload: row.payload,
  };
}
