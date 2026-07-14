import { z } from "zod";
import type { JobDef } from "../../jobs/scheduler";
import type { ToolDef } from "../../llm/provider";
import type { Skill } from "../skill";
import { computeFreeSlots, jstDate, jstToMs } from "./freebusy";
import type { GoogleCalendarClient } from "./google-client";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定");

const listEventsInput = z.object({
  date_from: dateSchema,
  date_to: dateSchema,
});

const findFreeSlotsInput = z.object({
  date_from: dateSchema,
  date_to: dateSchema,
  min_duration_minutes: z.number().int().positive().default(60),
});

/** 空きの探索対象とする時間帯（JST）。ライフスタイルに合わせて変えたくなったら env に出す */
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;

/** JST の日付範囲 [from, to] を ISO の半開区間に変換 */
function toIsoRange(dateFrom: string, dateTo: string): { timeMin: string; timeMax: string } {
  return {
    timeMin: `${dateFrom}T00:00:00+09:00`,
    timeMax: new Date(jstToMs(dateTo) + 24 * 3_600_000).toISOString(),
  };
}

export class CalendarSkill implements Skill {
  readonly name = "calendar";

  readonly tools: ToolDef[] = [
    {
      name: "list_events",
      description:
        "Googleカレンダーから指定期間の予定一覧を取得する。「明日の予定は？」「◯日に何がある？」など、予定の内容を聞かれたときに使う。日付は Asia/Tokyo の YYYY-MM-DD。単日なら date_from と date_to に同じ日付を指定する。",
      inputSchema: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "取得開始日 (YYYY-MM-DD)" },
          date_to: { type: "string", description: "取得終了日 (YYYY-MM-DD、この日を含む)" },
        },
        required: ["date_from", "date_to"],
      },
    },
    {
      name: "find_free_slots",
      description: `Googleカレンダーの予定をもとに指定期間の空き時間を計算する。「空いてる？」「候補日を出して」「◯日の午後は空いてる？」など、空き状況を聞かれたときに使う。空きは ${DAY_START_HOUR}:00〜${DAY_END_HOUR}:00 (Asia/Tokyo) の範囲で計算される。日付は YYYY-MM-DD。`,
      inputSchema: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "探索開始日 (YYYY-MM-DD)" },
          date_to: { type: "string", description: "探索終了日 (YYYY-MM-DD、この日を含む)" },
          min_duration_minutes: {
            type: "integer",
            description: "この分数以上の空きだけを返す（省略時 60）",
          },
        },
        required: ["date_from", "date_to"],
      },
    },
  ];

  constructor(
    private readonly client: GoogleCalendarClient,
    private readonly opts: { morningSummaryCron?: string } = {},
  ) {}

  /**
   * 毎朝の予定サマリー（M4-c）。当日の予定を取得し、軽量モデルで自然文に整形して通知する。
   * 予定ゼロの日も一言送る（ジョブが生きていることの確認を兼ねる）
   */
  get jobs(): JobDef[] {
    return [
      {
        name: "morning-summary",
        schedule: this.opts.morningSummaryCron ?? "30 7 * * *",
        run: async (ctx) => {
          const today = jstDate(Date.now());
          const { timeMin, timeMax } = toIsoRange(today, today);
          const events = await this.client.listEvents(timeMin, timeMax);
          if (events.length === 0) {
            await ctx.notify(`おはようございます。今日（${today}）の予定はありません。`);
            return;
          }
          const summary = await ctx.complete(
            `以下は今日（${today}）の予定一覧（JSON）です。朝の挨拶に続けて、予定を時刻順に簡潔にまとめた通知文を日本語で作ってください。` +
              `件数と各予定の開始時刻（HH:MM）を明記。終日予定は「終日」と書く。前置きや説明は不要で、通知文だけを出力してください。\n${JSON.stringify(events)}`,
          );
          await ctx.notify(summary);
        },
      },
    ];
  }

  async execute(toolName: string, input: unknown): Promise<string> {
    switch (toolName) {
      case "list_events": {
        const args = listEventsInput.parse(input);
        const { timeMin, timeMax } = toIsoRange(args.date_from, args.date_to);
        const events = await this.client.listEvents(timeMin, timeMax);
        return JSON.stringify({ events });
      }
      case "find_free_slots": {
        const args = findFreeSlotsInput.parse(input);
        const { timeMin, timeMax } = toIsoRange(args.date_from, args.date_to);
        const busy = await this.client.freeBusy(timeMin, timeMax);
        const days = computeFreeSlots({
          busy,
          rangeStart: Date.parse(timeMin),
          rangeEnd: Date.parse(timeMax),
          dayStartHour: DAY_START_HOUR,
          dayEndHour: DAY_END_HOUR,
          minMinutes: args.min_duration_minutes,
        });
        return JSON.stringify({
          search_hours: `${DAY_START_HOUR}:00-${DAY_END_HOUR}:00 (Asia/Tokyo)`,
          free_slots: days,
        });
      }
      default:
        throw new Error(`unknown tool: ${toolName}`);
    }
  }
}
