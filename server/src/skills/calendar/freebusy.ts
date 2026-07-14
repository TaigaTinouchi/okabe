/**
 * 空き時間計算の決定的ロジック（LLM には任せない）。
 * LLM の役割は「いつの・何を知りたいか」の抽出と結果の自然文化のみで、
 * busy 区間のマージ・営業時間内の空きスロット抽出はすべてここで行う。
 *
 * タイムゾーンは Asia/Tokyo 固定（UTC+9・DST なし）なので、
 * epoch ms に固定オフセットを足し引きするだけで日付境界を決定的に扱える。
 */

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 半開区間 [start, end)。epoch ms */
export interface Interval {
  start: number;
  end: number;
}

export interface DaySlots {
  /** JST の日付 YYYY-MM-DD */
  date: string;
  /** JST の "HH:mm-HH:mm" 表記の空きスロット */
  slots: string[];
}

/** epoch ms → JST の YYYY-MM-DD */
export function jstDate(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** epoch ms → JST の HH:mm */
export function jstTime(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(11, 16);
}

/** JST の YYYY-MM-DD（+時刻）→ epoch ms */
export function jstToMs(date: string, hour = 0, minute = 0): number {
  return Date.parse(`${date}T00:00:00+09:00`) + hour * 3_600_000 + minute * 60_000;
}

/** 重なり・隣接する busy 区間をマージし、時系列に整列する */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const cur of sorted) {
    const last = merged.at(-1);
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

export interface FreeSlotOptions {
  busy: Interval[];
  /** 探索範囲（epoch ms、半開区間） */
  rangeStart: number;
  rangeEnd: number;
  /** 空きとみなす時間帯（JST の時。デフォルト 8:00-20:00） */
  dayStartHour?: number;
  dayEndHour?: number;
  /** これ未満の隙間はスロットとして返さない */
  minMinutes?: number;
}

/**
 * 日ごとの空きスロットを返す。
 * - 終日予定: freebusy はその日全体を busy として返すため、その日はスロットなしになる
 * - 日をまたぐ予定: 日次ウィンドウとの交差で各日それぞれ正しく削られる
 * - 予定ゼロ: ウィンドウ全体が1つのスロットになる
 */
export function computeFreeSlots(opts: FreeSlotOptions): DaySlots[] {
  const dayStartHour = opts.dayStartHour ?? 8;
  const dayEndHour = opts.dayEndHour ?? 20;
  const minMs = (opts.minMinutes ?? 30) * 60_000;
  const busy = mergeIntervals(opts.busy);

  const days: DaySlots[] = [];
  // rangeStart を含む JST 日の 00:00 から日単位で歩く
  let dayStart = jstToMs(jstDate(opts.rangeStart));
  for (; dayStart < opts.rangeEnd; dayStart += DAY_MS) {
    const windowStart = Math.max(dayStart + dayStartHour * 3_600_000, opts.rangeStart);
    const windowEnd = Math.min(dayStart + dayEndHour * 3_600_000, opts.rangeEnd);
    if (windowEnd <= windowStart) {
      days.push({ date: jstDate(dayStart), slots: [] });
      continue;
    }

    const slots: string[] = [];
    let cursor = windowStart;
    for (const b of busy) {
      if (b.end <= windowStart || b.start >= windowEnd) continue;
      const gapEnd = Math.min(b.start, windowEnd);
      if (gapEnd - cursor >= minMs) {
        slots.push(`${jstTime(cursor)}-${jstTime(gapEnd)}`);
      }
      cursor = Math.max(cursor, Math.min(b.end, windowEnd));
    }
    if (windowEnd - cursor >= minMs) {
      slots.push(`${jstTime(cursor)}-${jstTime(windowEnd)}`);
    }
    days.push({ date: jstDate(dayStart), slots });
  }
  return days;
}
