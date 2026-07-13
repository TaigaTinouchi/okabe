# ADR-0005: LLM 抽象は自前の LlmProvider（メタフレームワーク不採用）

- Status: Accepted (2026-07-13)

## Decision

LLM へのアクセスは自前の小さなインターフェースに閉じる:

```ts
interface LlmProvider {
  chat(messages: ChatMessage[], tools: ToolDef[], opts?: { tier?: "light" | "heavy" }): AsyncIterable<LlmEvent>;
}
```

初期実装は Anthropic 公式 SDK による1プロバイダー・単一モデル。`tier` は受け取るが無視する
（階層ルーティングの将来の差し込み口としてシグネチャだけ確保）。

## Vercel AI SDK 等のメタフレームワークを使わない理由

AI SDK はプロバイダー抽象として定番だが、本プロジェクトの中核要件は
「全スキルの tool 定義を集約 → LLM の tool use でルーティング → 不発なら通常会話へフォールバック」
という**エージェントループそのもの**であり、ここを他人の抽象に預けると

1. tool use ループの制御（並列実行、エラー処理、通知への昇格）が SDK の設計に縛られる
2. 要件の tier フックは自前インターフェースなら数行で済む

検討した上で外す。プロバイダー追加が現実になった時点で再評価する（このADRを更新）。

## Consequences

- Anthropic SDK への依存は `server/src/llm/anthropic.ts` の1ファイルに閉じる
- ストリーミングイベント（text delta / tool use / stop）は自前の `LlmEvent` 型に正規化する
