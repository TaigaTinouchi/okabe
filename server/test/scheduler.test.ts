import { describe, expect, test } from "bun:test";
import { Cron } from "croner";
import { type JobContext, JobScheduler } from "../src/jobs/scheduler";
import { createDb } from "../src/store/db";
import { JobRunStore } from "../src/store/job-runs";

const noopCtx: JobContext = {
  notify: async () => {},
  complete: async () => "",
};

function makeScheduler(overrides: Partial<ConstructorParameters<typeof JobScheduler>[0]> = {}) {
  const runStore = new JobRunStore(createDb(":memory:"));
  const scheduler = new JobScheduler({
    runStore,
    ctx: noopCtx,
    retryDelayMs: 0,
    ...overrides,
  });
  return { scheduler, runStore };
}

describe("JobScheduler", () => {
  test("次回実行時刻: cron式は Asia/Tokyo で解釈される", () => {
    // 検証はライブラリ任せにせず、JSTの7:30がUTCの22:30(前日)であることを直接確認する
    const cron = new Cron("30 7 * * *", { timezone: "Asia/Tokyo" });
    const next = cron.nextRun();
    expect(next).not.toBeNull();
    if (!next) throw new Error("unreachable");
    expect(next.getUTCHours()).toBe(22); // 07:30 JST = 22:30 UTC
    expect(next.getUTCMinutes()).toBe(30);
    cron.stop();
  });

  test("成功時: 実行履歴が success で記録される", async () => {
    const { scheduler, runStore } = makeScheduler();
    let ran = 0;
    scheduler.register({
      name: "ok-job",
      schedule: "0 0 1 1 *", // 発火はテスト中に起きない。execute() を直接叩く
      run: async () => {
        ran++;
      },
    });
    await scheduler.execute("ok-job");
    scheduler.stop();

    expect(ran).toBe(1);
    const runs = runStore.listRecent();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ jobName: "ok-job", status: "success", attempt: 1 });
    expect(runs[0]?.finishedAt).toBeTruthy();
  });

  test("多重実行防止: 実行中の同一ジョブはスキップされる", async () => {
    const { scheduler } = makeScheduler();
    let entered = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    scheduler.register({
      name: "slow-job",
      schedule: "0 0 1 1 *",
      run: async () => {
        entered++;
        await gate;
      },
    });

    const first = scheduler.execute("slow-job");
    const second = await scheduler.execute("slow-job"); // 1回目が走行中
    expect(second).toBe("skipped");
    release();
    expect(await first).toBe("done");
    expect(entered).toBe(1);
    scheduler.stop();
  });

  test("リトライ上限: maxAttempts 回失敗したら諦め、履歴に全試行が残る", async () => {
    const { scheduler, runStore } = makeScheduler({ maxAttempts: 3 });
    let attempts = 0;
    scheduler.register({
      name: "broken-job",
      schedule: "0 0 1 1 *",
      run: async () => {
        attempts++;
        throw new Error("常に失敗");
      },
    });
    await scheduler.execute("broken-job");
    scheduler.stop();

    expect(attempts).toBe(3); // 無限リトライしない
    const runs = runStore.listRecent();
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.status === "failed")).toBe(true);
    expect(runs.map((r) => r.attempt).sort()).toEqual([1, 2, 3]);
    expect(runs[0]?.error).toContain("常に失敗");
  });

  test("途中で成功したらリトライを打ち切る", async () => {
    const { scheduler, runStore } = makeScheduler({ maxAttempts: 3 });
    let attempts = 0;
    scheduler.register({
      name: "flaky-job",
      schedule: "0 0 1 1 *",
      run: async () => {
        attempts++;
        if (attempts < 2) throw new Error("一時的失敗");
      },
    });
    await scheduler.execute("flaky-job");
    scheduler.stop();

    expect(attempts).toBe(2);
    const statuses = runStore.listRecent().map((r) => r.status);
    expect(statuses.sort()).toEqual(["failed", "success"]);
  });

  test("DISABLED_JOBS のジョブは登録されない", async () => {
    const { scheduler } = makeScheduler({ disabledJobs: new Set(["muted-job"]) });
    scheduler.register({
      name: "muted-job",
      schedule: "0 0 1 1 *",
      run: async () => {},
    });
    expect(scheduler.nextRuns()).toHaveLength(0);
    expect(scheduler.execute("muted-job")).rejects.toThrow("unknown job");
    scheduler.stop();
  });
});
