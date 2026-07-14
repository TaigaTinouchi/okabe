import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { jobRuns } from "./schema";

export type JobRun = typeof jobRuns.$inferSelect;

/** ジョブ実行履歴の記録と参照（M4-a） */
export class JobRunStore {
  constructor(private readonly db: Db) {}

  start(jobName: string, attempt: number): number {
    const row = this.db
      .insert(jobRuns)
      .values({ jobName, attempt, status: "running" })
      .returning({ id: jobRuns.id })
      .get();
    return row.id;
  }

  finish(id: number, status: "success" | "failed", error?: string): void {
    this.db
      .update(jobRuns)
      .set({
        status,
        error: error ?? null,
        finishedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      })
      .where(eq(jobRuns.id, id))
      .run();
  }

  listRecent(limit = 50): JobRun[] {
    return this.db.select().from(jobRuns).orderBy(desc(jobRuns.id)).limit(limit).all();
  }
}
