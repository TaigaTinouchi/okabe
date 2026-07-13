/**
 * エージェントの応答生成の縫い目。
 * M1: エコー。M2 で LlmProvider を使う実装に差し替わる（このインターフェースは不変）。
 */
export interface AgentReply {
  type: "assistant_message" | "notification";
  payload: { text: string };
}

export interface Agent {
  respond(userText: string): AsyncIterable<AgentReply>;
}

export class EchoAgent implements Agent {
  async *respond(userText: string): AsyncIterable<AgentReply> {
    yield { type: "assistant_message", payload: { text: `echo: ${userText}` } };
  }
}
