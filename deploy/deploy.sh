#!/usr/bin/env bash
# 更新デプロイ（VPS上で実行）: git pull → 依存解決 → 再起動
# マイグレーションは起動時に自動適用される（server/src/store/db.ts）
set -euo pipefail

cd "$(dirname "$0")/.."
echo "== git pull =="
git pull --ff-only

echo "== bun install =="
cd server
"$HOME/.bun/bin/bun" install --frozen-lockfile

echo "== restart =="
sudo /usr/bin/systemctl restart okabe
sleep 2
sudo /usr/bin/systemctl is-active okabe && echo "✅ okabe is running"
