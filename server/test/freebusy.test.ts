import { describe, expect, test } from "bun:test";
import { computeFreeSlots, jstToMs, mergeIntervals } from "../src/skills/calendar/freebusy";

/** JST時刻の busy 区間を作るヘルパー */
function busy(date: string, from: string, toDate: string, to: string) {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return {
    start: jstToMs(date, fh ?? 0, fm ?? 0),
    end: jstToMs(toDate, th ?? 0, tm ?? 0),
  };
}

describe("mergeIntervals", () => {
  test("重なり・隣接をマージし、空区間を捨てる", () => {
    const merged = mergeIntervals([
      busy("2026-07-15", "13:00", "2026-07-15", "14:00"),
      busy("2026-07-15", "10:00", "2026-07-15", "11:00"),
      busy("2026-07-15", "11:00", "2026-07-15", "12:00"), // 隣接 → 結合
      busy("2026-07-15", "13:30", "2026-07-15", "13:45"), // 内包 → 吸収
      { start: 100, end: 100 }, // 空区間 → 捨てる
    ]);
    expect(merged).toEqual([
      busy("2026-07-15", "10:00", "2026-07-15", "12:00"),
      busy("2026-07-15", "13:00", "2026-07-15", "14:00"),
    ]);
  });
});

describe("computeFreeSlots", () => {
  const day = (d: string) => ({
    rangeStart: jstToMs(d),
    rangeEnd: jstToMs(d) + 24 * 3_600_000,
  });

  test("予定ゼロの日は探索時間帯まるごと1スロット", () => {
    const days = computeFreeSlots({ busy: [], ...day("2026-07-15") });
    expect(days).toEqual([{ date: "2026-07-15", slots: ["08:00-20:00"] }]);
  });

  test("日中の予定でスロットが分割される", () => {
    const days = computeFreeSlots({
      busy: [
        busy("2026-07-15", "10:00", "2026-07-15", "11:30"),
        busy("2026-07-15", "15:00", "2026-07-15", "16:00"),
      ],
      ...day("2026-07-15"),
    });
    expect(days[0]?.slots).toEqual(["08:00-10:00", "11:30-15:00", "16:00-20:00"]);
  });

  test("終日予定の日はスロットなし", () => {
    // freebusy は終日予定を JST 00:00-24:00 の busy として返す
    const days = computeFreeSlots({
      busy: [busy("2026-07-15", "00:00", "2026-07-16", "00:00")],
      ...day("2026-07-15"),
    });
    expect(days).toEqual([{ date: "2026-07-15", slots: [] }]);
  });

  test("日をまたぐ予定は両日をそれぞれ正しく削る", () => {
    // 15日 18:00 〜 16日 10:00（夜行・宿泊など）
    const days = computeFreeSlots({
      busy: [busy("2026-07-15", "18:00", "2026-07-16", "10:00")],
      rangeStart: jstToMs("2026-07-15"),
      rangeEnd: jstToMs("2026-07-17"),
    });
    expect(days).toEqual([
      { date: "2026-07-15", slots: ["08:00-18:00"] },
      { date: "2026-07-16", slots: ["10:00-20:00"] },
    ]);
  });

  test("min_duration 未満の隙間は返さない", () => {
    const days = computeFreeSlots({
      busy: [
        busy("2026-07-15", "08:00", "2026-07-15", "12:00"),
        busy("2026-07-15", "12:45", "2026-07-15", "19:30"), // 隙間45分と30分
      ],
      ...day("2026-07-15"),
      minMinutes: 60,
    });
    expect(days[0]?.slots).toEqual([]);
  });

  test("複数日レンジで日ごとに計算される", () => {
    const days = computeFreeSlots({
      busy: [busy("2026-07-16", "08:00", "2026-07-16", "20:00")],
      rangeStart: jstToMs("2026-07-15"),
      rangeEnd: jstToMs("2026-07-18"),
    });
    expect(days.map((d) => d.date)).toEqual(["2026-07-15", "2026-07-16", "2026-07-17"]);
    expect(days[0]?.slots).toEqual(["08:00-20:00"]);
    expect(days[1]?.slots).toEqual([]);
    expect(days[2]?.slots).toEqual(["08:00-20:00"]);
  });
});
