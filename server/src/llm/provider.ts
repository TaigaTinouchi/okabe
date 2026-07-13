/**
 * LLMプロバイダーの縫い目（ADR-0005）。
 * `tier` は階層ルーティング（軽量/上位モデルの使い分け）の将来の差し込み口で、
 * 初期実装は受け取るが無視する。tools は M3 の Skill 機構で追加する。
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ModelTier = "light" | "heavy";

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "message_end"; text: string };

export interface ChatOptions {
  system?: string;
  tier?: ModelTier;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<LlmStreamEvent>;
}
