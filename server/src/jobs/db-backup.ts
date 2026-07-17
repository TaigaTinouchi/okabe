import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "../store/db";
import type { JobDef } from "./scheduler";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * SQLite の日次スナップショット（ADR-0008）。
 * `VACUUM INTO` はオンラインで安全に一貫したコピーを作れる。
 * ファイル名を JST の曜日にすることで自動的に7世代ローテーションになる。
 * スキルではなくコアのジョブとして server 起動時に登録される。
 */
export function createDbBackupJob(db: Db, dbPath: string): JobDef {
  return {
    name: "db-backup",
    schedule: "0 4 * * *", // 毎日 4:00 JST（利用の谷間）
    run: async () => {
      if (dbPath === ":memory:") return;
      const dir = join(dirname(resolve(dbPath)), "backups");
      mkdirSync(dir, { recursive: true });
      const weekday = WEEKDAYS[new Date(Date.now() + 9 * 3_600_000).getUTCDay()];
      const dest = join(dir, `okabe-${weekday}.db`);
      // VACUUM INTO は既存ファイルへ書けないため先に消す（前週の同曜日分）
      if (existsSync(dest)) rmSync(dest);
      db.run(sql`VACUUM INTO ${dest}`);
      console.log(`[jobs] db-backup → ${dest}`);
    },
  };
}
