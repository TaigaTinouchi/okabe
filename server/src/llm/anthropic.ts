import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, LlmProvider, LlmStreamEvent } from "./provider";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * リクエスト構築（純関数・テスト対象）。
 *
 * プロンプトキャッシング（M2.5）はこのプロバイダーの内部詳細であり、
 * LlmProvider インターフェースには漏らさない（ADR-0005）。
 * breakpoint は2箇所（上限4のうち）:
 *   1. system 末尾 — レンダリング順は tools → system → messages なので、
 *      ここ1つで「ツール定義 + システムプロンプト」の静的prefixがまとめて対象になる
 *   2. 最終メッセージ末尾 — ターンが進むたびに前ターンまでの履歴がキャッシュ読みになる
 * 注意: claude-opus-4-8 の最小キャッシュ単位は 4096 トークン。
 * それ未満の prefix では無害に不発する（cache_creation_input_tokens = 0）
 */
export function buildRequestParams(args: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
}): Anthropic.MessageStreamParams {
  const cacheControl = { type: "ephemeral" as const };

  const messages: Anthropic.MessageParam[] = args.messages.map((m, i) => {
    const isLast = i === args.messages.length - 1;
    if (!isLast) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [{ type: "text", text: m.content, cache_control: cacheControl }],
    };
  });

  return {
    model: args.model,
    max_tokens: args.maxTokens,
    thinking: { type: "adaptive" },
    system: args.system
      ? [{ type: "text", text: args.system, cache_control: cacheControl }]
      : undefined,
    messages,
  };
}

/** usage を JSONL 1行の構造化ログとして stdout に出す。scripts/usage-report.ts が集計する */
export function logUsage(model: string, usage: Anthropic.Usage): void {
  console.log(
    JSON.stringify({
      t: "llm_usage",
      ts: new Date().toISOString(),
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    }),
  );
}

/** Anthropic SDK への依存はこのファイルに閉じる（ADR-0005） */
export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async *chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<LlmStreamEvent> {
    // opts.tier は将来の階層ルーティング用。現状は単一モデル
    const stream = this.client.messages.stream(
      buildRequestParams({
        model: this.model,
        maxTokens: this.maxTokens,
        system: opts?.system,
        messages,
      }),
    );

    let full = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        full += event.delta.text;
        yield { type: "text_delta", text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    logUsage(this.model, final.usage);
    yield { type: "message_end", text: full };
  }
}
