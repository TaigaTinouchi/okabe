import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * イベント受信箱（ADR-0003）。
 * エージェント発・ユーザー発を問わず、会話タイムラインの全イベントを追記する。
 * 配送はこのテーブルへの永続化の後。クライアントは id を使って catch-up する。
 */
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).notNull().$type<{ text: string }>(),
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});
