/**
 * LLMプロバイダーの縫い目（ADR-0005）。
 * `tier` は階層ルーティング（軽量/上位モデルの使い分け）の将来の差し込み口で、
 * 初期実装は受け取るが無視する。
 */

/** ツール定義。inputSchema は JSON Schema（プロバイダー非依存の表現） */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * メッセージの内容ブロック（プロバイダー非依存の表現）。
 * `provider_raw` はプロバイダー固有のブロック（Anthropic の thinking 等）を
 * 解釈せずそのまま往復させるための封筒。ツールループの途中でこれを落とすと
 * プロバイダー側で検証エラーになるため、エージェントは中身に触れず持ち回る。
 */
export type ChatContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | { type: "provider_raw"; raw: unknown };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ChatContent[];
}

export type ModelTier = "light" | "heavy";

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "other";

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "message_end";
      /** このターンでモデルが出力したテキストの連結 */
      text: string;
      stopReason: StopReason;
      /** 応答の全ブロック。tool_use 継続時にそのまま assistant メッセージとして返送する */
      assistantContent: ChatContent[];
    };

export interface ChatOptions {
  system?: string;
  tools?: ToolDef[];
  tier?: ModelTier;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<LlmStreamEvent>;
}
