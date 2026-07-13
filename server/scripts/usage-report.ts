/**
 * LLM トークン消費の日別レポート。
 * サーバーの stdout ログ（llm_usage の JSONL 行を含むもの）を食わせる。
 *
 *   bun scripts/usage-report.ts server.log
 *   journalctl -u okabe --since "7 days ago" -o cat | bun scripts/usage-report.ts
 */

// claude-opus-4-8 の単価（USD / 1M tokens）
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

interface UsageLine {
  t: string;
  ts: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface DayAgg {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function parseLine(line: string): UsageLine | null {
  // journald 等のプレフィックス付きでも拾えるよう、JSON 部分を切り出す
  const start = line.indexOf('{"t":"llm_usage"');
  if (start === -1) return null;
  try {
    return JSON.parse(line.slice(start)) as UsageLine;
  } catch {
    return null;
  }
}

const source = Bun.argv[2] ? Bun.file(Bun.argv[2]) : Bun.stdin;
const text = await source.text();

const days = new Map<string, DayAgg>();
for (const line of text.split("\n")) {
  const u = parseLine(line);
  if (!u) continue;
  const day = u.ts.slice(0, 10);
  const agg = days.get(day) ?? { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  agg.requests++;
  agg.input += u.input_tokens;
  agg.output += u.output_tokens;
  agg.cacheRead += u.cache_read_input_tokens;
  agg.cacheWrite += u.cache_creation_input_tokens;
  days.set(day, agg);
}

if (days.size === 0) {
  console.log("llm_usage の行が見つかりませんでした");
  process.exit(1);
}

console.log(
  "date        req   input    cache_r  cache_w  output   hit%   est.cost",
);
for (const [day, a] of [...days.entries()].sort()) {
  const promptTotal = a.input + a.cacheRead + a.cacheWrite;
  const hitRate = promptTotal === 0 ? 0 : (a.cacheRead / promptTotal) * 100;
  const cost =
    (a.input * PRICE.input +
      a.output * PRICE.output +
      a.cacheRead * PRICE.cacheRead +
      a.cacheWrite * PRICE.cacheWrite) /
    1_000_000;
  console.log(
    [
      day,
      String(a.requests).padStart(5),
      String(a.input).padStart(8),
      String(a.cacheRead).padStart(8),
      String(a.cacheWrite).padStart(8),
      String(a.output).padStart(8),
      `${hitRate.toFixed(1)}%`.padStart(6),
      `$${cost.toFixed(4)}`.padStart(9),
    ].join(" "),
  );
}
