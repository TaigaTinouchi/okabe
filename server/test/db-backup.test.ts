import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDbBackupJob } from "../src/jobs/db-backup";
import type { JobContext } from "../src/jobs/scheduler";
import { createDb } from "../src/store/db";
import { EventStore } from "../src/store/events";

const noopCtx: JobContext = { notify: async () => {}, complete: async () => "" };

describe("db-backup ジョブ（ADR-0008）", () => {
  test("VACUUM INTO で曜日名のスナップショットが作られ、中身が読める", async () => {
    const dir = mkdtempSync(join(tmpdir(), "okabe-backup-"));
    const dbPath = join(dir, "okabe.db");
    try {
      const db = createDb(dbPath);
      new EventStore(db).append("user_message", { text: "バックアップ対象" });

      const job = createDbBackupJob(db, dbPath);
      expect(job.schedule).toBe("0 4 * * *");
      await job.run(noopCtx);
      // 同日2回目（既存ファイルあり）でも壊れない
      await job.run(noopCtx);

      const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
        new Date(Date.now() + 9 * 3_600_000).getUTCDay()
      ];
      const backupPath = join(dir, "backups", `okabe-${weekday}.db`);
      expect(existsSync(backupPath)).toBe(true);

      // スナップショットが独立して読めて、データが入っている
      const restored = new Database(backupPath, { readonly: true });
      const row = restored.query("select count(*) as n from events").get() as { n: number };
      expect(row.n).toBe(1);
      restored.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
