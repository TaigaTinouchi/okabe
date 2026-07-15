import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatContent,
  ChatMessage,
  ChatOptions,
  LlmProvider,
  LlmStreamEvent,
  StopReason,
  ToolDef,
} from "./provider";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /** tier: "light" 指定時に使う軽量モデル（サマリー整形などの軽タスク用） */
  lightModel?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_LIGHT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 8_192;

function toSdkBlock(block: ChatContent): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    case "provider_raw":
      // thinking 等。受信時のブロックをそのまま返送する（改変すると 400）
      return block.raw as Anthropic.ContentBlockParam;
  }
}

function fromSdkBlock(block: Anthropic.ContentBlock): ChatContent {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    default:
      return { type: "provider_raw", raw: block };
  }
}

function mapStopReason(reason: string | null): StopReason {
  if (reason === "end_turn" || reason === "tool_use" || reason === "max_tokens") return reason;
  return "other";
}

/**
 * リクエスト構築（純関数・テスト対象）。
 *
 * プロンプトキャッシング（M2.5）はこのプロバイダーの内部詳細であり、
 * LlmProvider インターフェースには漏らさない（ADR-0005）。
 * breakpoint は2箇所（上限4のうち）:
 *   1. system 末尾 — レンダリング順は tools → system → messages なので、
 *      ここ1つで「ツール定義 + システムプロンプト」の静的prefixがまとめて対象になる
 *   2. 最終メッセージ末尾 — ターンが進むたびに前ターンまでの履歴がキャッシュ読みになる
 * 注意: 最小キャッシュ単位はモデル依存（sonnet-4-6: 2048 / opus-4-8: 4096 トークン）。
 * それ未満の prefix では無害に不発する（cache_creation_input_tokens = 0）
 */
export function buildRequestParams(args: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  /**
   * adaptive thinking を有効にするか。軽量モデル（Haiku 4.5 等）は
   * adaptive 未対応のため false にする（省略時はthinkingなしで動く）
   */
  adaptiveThinking?: boolean;
}): Anthropic.MessageStreamParams {
  const cacheControl = { type: "ephemeral" as const };

  const messages: Anthropic.MessageParam[] = args.messages.map((m, i) => {
    const isLast = i === args.messages.length - 1;
    const blocks: Anthropic.ContentBlockParam[] =
      typeof m.content === "string"
        ? [{ type: "text", text: m.content }]
        : m.content.map(toSdkBlock);
    if (!isLast) {
      // 文字列のままにしておくと prefix のバイト列が安定する（ブロック化は必要な時だけ）
      return typeof m.content === "string"
        ? { role: m.role, content: m.content }
        : { role: m.role, content: blocks };
    }
    const last = blocks.at(-1);
    if (last && last.type !== "thinking" && last.type !== "redacted_thinking") {
      (last as { cache_control?: unknown }).cache_control = cacheControl;
    }
    return { role: m.role, content: blocks };
  });

  return {
    model: args.model,
    max_tokens: args.maxTokens,
    ...(args.adaptiveThinking !== false ? { thinking: { type: "adaptive" as const } } : {}),
    system: args.system
      ? [{ type: "text", text: args.system, cache_control: cacheControl }]
      : undefined,
    tools: args.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    })),
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
  private readonly lightModel: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.lightModel = opts.lightModel ?? DEFAULT_LIGHT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async *chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<LlmStreamEvent> {
    // 階層ルーティング（M4で初適用）: 軽タスクは light モデルに振る。
    // Haiku 4.5 は adaptive thinking 未対応のため light では thinking を外す
    const light = opts?.tier === "light";
    const model = light ? this.lightModel : this.model;
    const stream = this.client.messages.stream(
      buildRequestParams({
        model,
        maxTokens: this.maxTokens,
        system: opts?.system,
        messages,
        tools: opts?.tools,
        adaptiveThinking: !light,
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
    logUsage(model, final.usage);
    yield {
      type: "message_end",
      text: full,
      stopReason: mapStopReason(final.stop_reason),
      assistantContent: final.content.map(fromSdkBlock),
    };
  }
}
