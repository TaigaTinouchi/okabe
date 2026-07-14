import { eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { readState } from "./schema";

const ROW_ID = 1;

/** 既読カーソル（M4-b）。シングルユーザーなので単一行 */
export class ReadStateStore {
  constructor(private readonly db: Db) {}

  get(): number {
    const row = this.db.select().from(readState).where(eq(readState.id, ROW_ID)).get();
    return row?.lastReadEventId ?? 0;
  }

  /** カーソルは単調増加のみ（古い値で巻き戻さない） */
  advance(eventId: number): number {
    const current = this.get();
    if (eventId <= current) return current;
    this.db
      .insert(readState)
      .values({ id: ROW_ID, lastReadEventId: eventId })
      .onConflictDoUpdate({
        target: readState.id,
        set: {
          lastReadEventId: eventId,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
        },
      })
      .run();
    return eventId;
  }
}
