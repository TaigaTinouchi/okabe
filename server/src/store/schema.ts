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

/** ジョブ実行履歴（M4-a）。いつ・どのジョブが・何回目の試行で・成功したかを残す */
export const jobRuns = sqliteTable("job_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobName: text("job_name").notNull(),
  attempt: integer("attempt").notNull().default(1),
  status: text("status").notNull().$type<"running" | "success" | "failed">(),
  error: text("error"),
  startedAt: text("started_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  finishedAt: text("finished_at"),
});

/**
 * 既読カーソル（M4-b）。シングルユーザーなので1行だけ持ち、
 * 「この id までのイベントはクライアントで表示済み」を表す
 */
export const readState = sqliteTable("read_state", {
  id: integer("id").primaryKey(),
  lastReadEventId: integer("last_read_event_id").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});
