import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, LlmProvider, LlmStreamEvent } from "./provider";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 8_192;

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
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: "adaptive" },
      system: opts?.system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    let full = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        full += event.delta.text;
        yield { type: "text_delta", text: event.delta.text };
      }
    }
    yield { type: "message_end", text: full };
  }
}
