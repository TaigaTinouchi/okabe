import { describe, expect, test } from "bun:test";
import type { JobContext } from "../src/jobs/scheduler";
import { CalendarSkill } from "../src/skills/calendar";
import { GoogleCalendarClient } from "../src/skills/calendar/google-client";

function makeSkill(events: unknown[], cron?: string) {
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "at", expires_in: 3600 });
    }
    return Response.json({ items: events });
  }) as typeof fetch;
  return new CalendarSkill(
    new GoogleCalendarClient({ clientId: "c", clientSecret: "s", refreshToken: "r", fetchFn }),
    { morningSummaryCron: cron },
  );
}

function makeCtx() {
  const notified: string[] = [];
  const completed: string[] = [];
  const ctx: JobContext = {
    notify: async (text) => {
      notified.push(text);
    },
    complete: async (prompt) => {
      completed.push(prompt);
      return "おはようございます。今日の予定は2件です。";
    },
  };
  return { ctx, notified, completed };
}

describe("morning-summary ジョブ（M4-c）", () => {
  test("予定あり: LLM整形（light tier 経由）の結果を通知する", async () => {
    const skill = makeSkill([
      {
        summary: "定例",
        start: { dateTime: "2026-07-15T10:00:00+09:00" },
        end: { dateTime: "2026-07-15T11:00:00+09:00" },
      },
      { summary: "健康診断", start: { date: "2026-07-15" }, end: { date: "2026-07-16" } },
    ]);
    const job = skill.jobs[0];
    if (!job) throw new Error("job not registered");
    expect(job.name).toBe("morning-summary");
    expect(job.schedule).toBe("30 7 * * *"); // デフォルト 7:30 JST

    const { ctx, notified, completed } = makeCtx();
    await job.run(ctx);

    // 予定JSONが整形プロンプトに含まれ、整形結果がそのまま通知される
    expect(completed).toHaveLength(1);
    expect(completed[0]).toContain("定例");
    expect(completed[0]).toContain("健康診断");
    expect(notified).toEqual(["おはようございます。今日の予定は2件です。"]);
  });

  test("予定ゼロ: LLMを呼ばず「予定なし」を一言通知する（生存確認を兼ねる）", async () => {
    const skill = makeSkill([]);
    const job = skill.jobs[0];
    if (!job) throw new Error("job not registered");

    const { ctx, notified, completed } = makeCtx();
    await job.run(ctx);

    expect(completed).toHaveLength(0);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("予定はありません");
  });

  test("cron はコンフィグで差し替えられる", () => {
    const skill = makeSkill([], "0 9 * * 1-5");
    expect(skill.jobs[0]?.schedule).toBe("0 9 * * 1-5");
  });
});
