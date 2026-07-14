import { describe, expect, test } from "bun:test";
import { CalendarSkill } from "../src/skills/calendar";
import { GoogleCalendarClient } from "../src/skills/calendar/google-client";

/** Google API を再現するフェイク fetch */
function makeFakeFetch(handlers: { events?: unknown; freeBusy?: unknown }): {
  fetchFn: typeof fetch;
  requests: Array<{ url: string; body?: unknown }>;
} {
  const requests: Array<{ url: string; body?: unknown }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "at-1", expires_in: 3600 });
    }
    if (url.includes("/freeBusy")) {
      return Response.json(handlers.freeBusy);
    }
    if (url.includes("/events")) {
      return Response.json(handlers.events);
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetchFn, requests };
}

function makeSkill(handlers: Parameters<typeof makeFakeFetch>[0]) {
  const { fetchFn, requests } = makeFakeFetch(handlers);
  const skill = new CalendarSkill(
    new GoogleCalendarClient({
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "rt",
      fetchFn,
    }),
  );
  return { skill, requests };
}

describe("CalendarSkill", () => {
  test("list_events: 時刻あり・終日の両方を正規化して返す", async () => {
    const { skill, requests } = makeSkill({
      events: {
        items: [
          {
            summary: "定例MTG",
            start: { dateTime: "2026-07-15T10:00:00+09:00" },
            end: { dateTime: "2026-07-15T11:00:00+09:00" },
            location: "Zoom",
          },
          {
            summary: "夏休み",
            start: { date: "2026-07-15" },
            end: { date: "2026-07-16" },
          },
        ],
      },
    });

    const out = JSON.parse(
      await skill.execute("list_events", { date_from: "2026-07-15", date_to: "2026-07-15" }),
    );
    expect(out.events).toEqual([
      {
        summary: "定例MTG",
        start: "2026-07-15T10:00:00+09:00",
        end: "2026-07-15T11:00:00+09:00",
        allDay: false,
        location: "Zoom",
      },
      { summary: "夏休み", start: "2026-07-15", end: "2026-07-16", allDay: true },
    ]);

    // token 交換 → events.list の2リクエスト。期間は JST の日付境界
    expect(requests[0]?.url).toContain("oauth2.googleapis.com/token");
    expect(requests[1]?.url).toContain("timeMin=2026-07-15T00%3A00%3A00%2B09%3A00");
  });

  test("find_free_slots: freebusy から決定的に空きを計算する", async () => {
    const { skill } = makeSkill({
      freeBusy: {
        calendars: {
          primary: {
            busy: [
              { start: "2026-07-15T01:00:00Z", end: "2026-07-15T03:00:00Z" }, // JST 10:00-12:00
            ],
          },
        },
      },
    });

    const out = JSON.parse(
      await skill.execute("find_free_slots", {
        date_from: "2026-07-15",
        date_to: "2026-07-15",
        min_duration_minutes: 90,
      }),
    );
    expect(out.free_slots).toEqual([{ date: "2026-07-15", slots: ["08:00-10:00", "12:00-20:00"] }]);
  });

  test("access token はキャッシュされ token 交換は1回だけ", async () => {
    const { skill, requests } = makeSkill({ events: { items: [] } });
    await skill.execute("list_events", { date_from: "2026-07-15", date_to: "2026-07-15" });
    await skill.execute("list_events", { date_from: "2026-07-16", date_to: "2026-07-16" });
    const tokenCalls = requests.filter((r) => r.url.includes("oauth2.googleapis.com"));
    expect(tokenCalls).toHaveLength(1);
  });

  test("不正な入力は zod で弾く", async () => {
    const { skill } = makeSkill({});
    expect(
      skill.execute("list_events", { date_from: "明日", date_to: "2026-07-15" }),
    ).rejects.toThrow();
  });
});
