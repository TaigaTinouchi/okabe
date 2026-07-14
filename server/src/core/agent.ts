import type { ChatContent, ChatMessage, LlmProvider } from "../llm/provider";
import { SkillRegistry } from "../skills/skill";
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

const STATIC_SYSTEM_PROMPT = `あなたは「okabe」、ユーザー専属のパーソナルアシスタント。
サーバーに常駐し、会話への応答に加えて、定期ジョブからの通知・報告も行う。
応答は日本語で、簡潔に。チャットUIで読まれるため、長い前置きや過剰な確認は不要。
ツールが提供されている場合、それが必要な質問（予定・空き時間など）にはツールを使って答える。
ツールで得た事実だけを答え、推測で予定をでっち上げない。できないことはできないと答える。`;

/** ツール実行を挟む往復の上限。暴走防止のガードレール */
const MAX_TOOL_ITERATIONS = 5;

/**
 * M2/M3: 会話履歴つきの LLM 応答 + tool use によるスキルルーティング。
 * 履歴はイベント受信箱そのもの（user_message / assistant_message の直近N件）。
 * ユーザーの発話は respond() が呼ばれる前に受信箱へ永続化済みなので、
 * listRecentConversation() の末尾が「今の発話」になる。
 */
export class LlmAgent implements Agent {
  constructor(
    private readonly provider: LlmProvider,
    private readonly store: EventStore,
    private readonly skills: SkillRegistry = new SkillRegistry([]),
    private readonly historyLimit = 30,
  ) {}

  async *respond(_userText: string): AsyncIterable<AgentEvent> {
    const history = this.store.listRecentConversation(this.historyLimit);
    const messages: ChatMessage[] = history.map((e) => ({
      role: e.type === "user_message" ? ("user" as const) : ("assistant" as const),
      content: e.payload.text,
    }));
    // 先頭は user でなければならない（履歴の切れ目で assistant が先頭に来た場合を除去）
    while (messages.length > 0 && messages[0]?.role !== "user") {
      messages.shift();
    }

    const opts = {
      system: this.systemPrompt(),
      tools: this.skills.isEmpty ? undefined : this.skills.tools,
    };

    // エージェントループ: tool_use が返る限りスキルを実行して往復する（ADR-0005 の中核）
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let text = "";
      let stopReason: string = "end_turn";
      let assistantContent: ChatContent[] = [];

      for await (const event of this.provider.chat(messages, opts)) {
        if (event.type === "text_delta") {
          yield { kind: "delta", text: event.text };
        } else {
          text = event.text; // プロバイダーが返す全文が正
          stopReason = event.stopReason;
          assistantContent = event.assistantContent;
        }
      }

      if (stopReason !== "tool_use") {
        yield {
          kind: "message",
          type: "assistant_message",
          payload: { text },
        };
        return;
      }

      // ツール実行。応答ブロック（thinking 含む）はそのまま assistant として返送する
      const toolUses = assistantContent.filter((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: assistantContent });
      const results: ChatContent[] = await Promise.all(
        toolUses.map(async (tu) => {
          try {
            const content = await this.skills.execute(tu.name, tu.input);
            return { type: "tool_result" as const, toolUseId: tu.id, content };
          } catch (err) {
            console.error(`[skill] ${tu.name} failed: ${String(err)}`);
            return {
              type: "tool_result" as const,
              toolUseId: tu.id,
              content: `ツールの実行に失敗しました: ${String(err)}`,
              isError: true,
            };
          }
        }),
      );
      messages.push({ role: "user", content: results });
    }

    yield {
      kind: "message",
      type: "assistant_message",
      payload: { text: "（ツールの呼び出しが上限に達したため中断しました）" },
    };
  }

  private systemPrompt(): string {
    // 「明日」「来週」を解釈できるよう今日の日付だけ渡す。
    // 時刻まで入れると毎リクエストでプロンプトキャッシュが無効化されるため日付のみ
    // （日付の変わり目に1日1回だけ無効化されるのは許容）
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // Asia/Tokyo (UTC+9, DSTなし)
    const date = now.toISOString().slice(0, 10);
    const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getUTCDay()];
    return `${STATIC_SYSTEM_PROMPT}\n\n今日の日付: ${date}（${weekday}曜日）。タイムゾーンは Asia/Tokyo。`;
  }
}
