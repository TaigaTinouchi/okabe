# ADR-0001: ランタイムに Bun、Webフレームワークに Hono を採用する

- Status: Accepted (2026-07-13)

## Context

本プロジェクトは安価なVPS 1台で動く**常駐デーモン**であり、個人開発として運用の敵は依存関係の数と
ビルドチェーンの複雑さになる。要件は「HTTPサーバー + WebSocket + cron + SQLite + LLM API呼び出し」を
1プロセスに同居させること。

## Decision

ランタイムに **Bun**、Webフレームワークに **Hono** を採用する。

Node.js 構成では runtime + tsx + better-sqlite3（ネイティブビルド）+ ws + vitest + npm と積み上がるものが、
Bun ではランタイム・TypeScript実行・SQLiteドライバ（`bun:sqlite`）・WebSocketサーバー・テストランナー・
パッケージマネージャが1バイナリに収まる。これは「新しいから使う」ではなく、
**個人デーモンの依存最小化**という要件への直接の回答である。ARM（Hetzner CAX11 等）対応済み。

Hono は Web Standards（Request/Response）準拠で、ルーティングと認証ミドルウェアに必要十分な最小API を持つ。

## Consequences

- 開発・テスト・実行が `bun` コマンドに統一される
- Bun は Node より若く、エッジケースの実績は劣る。緩和策として **Hono が Web Standards 準拠**であることを
  縫い目とし、問題が出た場合は Node 24（ネイティブTS実行）+ better-sqlite3 へ移行できる。
  SQLite アクセスは Drizzle 経由なのでドライバ差し替えは設定1行（ADR-0002）

## Alternatives considered

- **Node.js 24 LTS**: 最も枯れているが、同等機能のために依存が5個以上増える
- **Python (FastAPI)**: LLMエコシステムは厚いが、常駐WS+cronの同居はNode系のイベントループの方が素直
- **Go / Rust**: 運用面は最強だが、個人開発の反復速度を犠牲にするほどの要件がない
