import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
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

  /**
   * 会話履歴として意味を持つイベントの直近 limit 件を時系列順で返す。
   * LLM に渡す文脈はこの受信箱がそのまま真実（別テーブルを持たない）。
   * 通知も含める: 「（朝の通知を受けて）2件目の詳細教えて」が文脈として通じるように（M4-c）
   */
  listRecentConversation(limit = 30): ServerEvent[] {
    return this.db
      .select()
      .from(events)
      .where(inArray(events.type, ["user_message", "assistant_message", "notification"]))
      .orderBy(desc(events.id))
      .limit(limit)
      .all()
      .map(toServerEvent)
      .reverse();
  }

  /** 未読通知（既読カーソルより後の notification）を昇順で返す（M4-b） */
  listNotificationsAfter(after: number, limit = 100): ServerEvent[] {
    return this.db
      .select()
      .from(events)
      .where(and(eq(events.type, "notification"), gt(events.id, after)))
      .orderBy(asc(events.id))
      .limit(limit)
      .all()
      .map(toServerEvent);
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
