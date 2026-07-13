import type { LlmProvider } from "../llm/provider";
import type { EventStore } from "../store/events";

/**
 * エージェントの応答生成の縫い目。
 * - `delta`: ストリーミング断片。永続化されず、接続中のクライアントにのみ流れる
 * - `message`: 確定イベント。受信箱に永続化され catch-up の対象になる
 */
export type AgentEvent =
  | { kind: "delta"; text: string }
  | {
      kind: "message";
      type: "assistant_message" | "notification";
      payload: { text: string };
    };

export interface Agent {
  respond(userText: string): AsyncIterable<AgentEvent>;
}

/** M1の疎通確認用。ANTHROPIC_API_KEY 未設定時のフォールバックとして残す */
export class EchoAgent implements Agent {
  async *respond(userText: string): AsyncIterable<AgentEvent> {
    yield {
      kind: "message",
      type: "assistant_message",
      payload: { text: `echo: ${userText}` },
    };
  }
}

const SYSTEM_PROMPT = `あなたは「okabe」、ユーザー専属のパーソナルアシスタント。
サーバーに常駐し、会話への応答に加えて、定期ジョブからの通知・報告も行う。
応答は日本語で、簡潔に。チャットUIで読まれるため、長い前置きや過剰な確認は不要。
まだカレンダー等の外部ツールには接続されていない。できないことはできないと答える。`;

/**
 * M2: 会話履歴つきの LLM 応答。
 * 履歴はイベント受信箱そのもの（user_message / assistant_message の直近N件）。
 * ユーザーの発話は respond() が呼ばれる前に受信箱へ永続化済みなので、
 * listRecentConversation() の末尾が「今の発話」になる。
 */
export class LlmAgent implements Agent {
  constructor(
    private readonly provider: LlmProvider,
    private readonly store: EventStore,
    private readonly historyLimit = 30,
  ) {}

  async *respond(_userText: string): AsyncIterable<AgentEvent> {
    const history = this.store.listRecentConversation(this.historyLimit);
    const messages = history.map((e) => ({
      role: e.type === "user_message" ? ("user" as const) : ("assistant" as const),
      content: e.payload.text,
    }));
    // 先頭は user でなければならない（履歴の切れ目で assistant が先頭に来た場合を除去）
    while (messages.length > 0 && messages[0]?.role !== "user") {
      messages.shift();
    }

    for await (const event of this.provider.chat(messages, { system: SYSTEM_PROMPT })) {
      if (event.type === "text_delta") {
        yield { kind: "delta", text: event.text };
      } else {
        yield {
          kind: "message",
          type: "assistant_message",
          payload: { text: event.text },
        };
      }
    }
  }
}
