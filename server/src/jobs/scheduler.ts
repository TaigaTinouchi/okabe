import { Cron } from "croner";
import type { JobRunStore } from "../store/job-runs";

/**
 * ジョブに渡される実行コンテキスト（M4-a/c）。
 * - notify: エージェント発の通知として配信（受信箱に永続化 → 全チャネルへ）
 * - complete: 軽量モデルでの一発テキスト生成（サマリー整形など）。
 *   階層ルーティング（tier: light）の最初の適用ポイント
 */
export interface JobContext {
  notify(text: string): Promise<void>;
  complete(prompt: string): Promise<string>;
}

export interface JobDef {
  name: string;
  /** cron式（5フィールド）。Asia/Tokyo で解釈される */
  schedule: string;
  run(ctx: JobContext): Promise<void>;
}

export interface SchedulerOptions {
  runStore: JobRunStore;
  ctx: JobContext;
  /** 設定で無効化されたジョブ名（DISABLED_JOBS） */
  disabledJobs?: Set<string>;
  timezone?: string;
  /** 失敗時の総試行回数（初回含む） */
  maxAttempts?: number;
  /** リトライ間隔（テストで0にする） */
  retryDelayMs?: number;
}

/**
 * プロセス内ジョブスケジューラ（ADR-0007）。
 * - スケジュールは croner（タイムゾーン対応）。再起動対応は「起動時再登録」方式
 * - 多重実行防止: 実行中のジョブ名を保持し、重なった発火はスキップ
 * - リトライ: 最大 maxAttempts 回。無限リトライはしない
 * - 実行履歴: job_runs テーブルに毎試行を記録
 */
export class JobScheduler {
  private readonly jobs = new Map<string, JobDef>();
  private readonly crons: Cron[] = [];
  private readonly running = new Set<string>();
  private readonly opts: Required<Omit<SchedulerOptions, "runStore" | "ctx">> & SchedulerOptions;

  constructor(opts: SchedulerOptions) {
    this.opts = {
      disabledJobs: new Set(),
      timezone: "Asia/Tokyo",
      maxAttempts: 3,
      retryDelayMs: 60_000,
      ...opts,
    };
  }

  register(job: JobDef): void {
    if (this.opts.disabledJobs?.has(job.name)) {
      console.log(`[jobs] "${job.name}" は設定で無効化されています`);
      return;
    }
    if (this.jobs.has(job.name)) throw new Error(`duplicate job name: ${job.name}`);
    this.jobs.set(job.name, job);
    const cron = new Cron(job.schedule, { timezone: this.opts.timezone }, () => {
      void this.execute(job.name);
    });
    this.crons.push(cron);
    console.log(
      `[jobs] "${job.name}" 登録 (${job.schedule} ${this.opts.timezone}) 次回: ${cron.nextRun()?.toISOString()}`,
    );
  }

  /** 発火時の実行本体。テスト・手動実行からも呼べる */
  async execute(jobName: string): Promise<"done" | "skipped"> {
    const job = this.jobs.get(jobName);
    if (!job) throw new Error(`unknown job: ${jobName}`);
    if (this.running.has(jobName)) {
      console.warn(`[jobs] "${jobName}" は実行中のためスキップ（多重実行防止）`);
      return "skipped";
    }
    this.running.add(jobName);
    try {
      for (let attempt = 1; attempt <= (this.opts.maxAttempts ?? 3); attempt++) {
        const runId = this.opts.runStore.start(jobName, attempt);
        try {
          await job.run(this.opts.ctx);
          this.opts.runStore.finish(runId, "success");
          return "done";
        } catch (err) {
          this.opts.runStore.finish(runId, "failed", String(err));
          console.error(
            JSON.stringify({
              t: "job_error",
              ts: new Date().toISOString(),
              job: jobName,
              attempt,
              error: String(err),
            }),
          );
          if (attempt < (this.opts.maxAttempts ?? 3)) {
            await new Promise((r) => setTimeout(r, this.opts.retryDelayMs));
          }
        }
      }
      return "done";
    } finally {
      this.running.delete(jobName);
    }
  }

  /** 登録済みジョブと次回実行時刻（起動ログ・運用確認用） */
  nextRuns(): Array<{ name: string; nextRun: Date | null }> {
    return this.crons.map((c, i) => ({
      name: [...this.jobs.keys()][i] ?? "?",
      nextRun: c.nextRun(),
    }));
  }

  stop(): void {
    for (const c of this.crons) c.stop();
  }
}
