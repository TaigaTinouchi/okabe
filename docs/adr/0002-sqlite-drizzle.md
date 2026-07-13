# ADR-0002: 永続化は SQLite + Drizzle ORM

- Status: Accepted (2026-07-13)

## Decision

永続化は **SQLite**（`bun:sqlite`）を **Drizzle ORM** 経由で使う。

## Context / 理由

個人エージェントの真の運用コストは「DBの面倒を見る時間」。SQLite は単一ファイルで、
バックアップは `cp` 1回、プロセス内で完結しゼロオペレーション。
会話履歴・イベント受信箱・ジョブ状態と伸びていくスキーマの変更履歴は `drizzle-kit` の
マイグレーションでコード管理する。スキーマがTypeScriptコードなので型が端まで通る。

## PostgreSQL（pgvector）を今は選ばない理由

将来のメモリ/RAG系スキルでベクトル検索が欲しくなる可能性は認識している。その時の選択肢は

1. **sqlite-vec**: SQLite のまま拡張1個で近傍検索を足す
2. **Drizzle の dialect 差し替え**で PostgreSQL + pgvector へ移行する

の2本が残る。逆に今 PostgreSQL を入れると、VPS にコンテナ管理と `pg_dump` バックアップ運用が
最初から付いてきて、使わないベクトル検索のために払う代償として高すぎる。
「必要になった時に移れる縫い目を確認した上で、運用ゼロの側から始める」判断。

## Consequences

- DBアクセスは `server/src/store/` に閉じる。他レイヤは SQL を知らない
- 同時書き込みはシングルプロセス前提（WALモード）。この前提が崩れる時が PostgreSQL 移行の時
