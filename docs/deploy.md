# 本番配置手順（VPS）

配備先・方式の判断は [ADR-0008](adr/0008-deploy-target.md)（WebARENA Indigo 2GB / systemd直置き / Caddy）。
この手順は Ubuntu 24.04 を前提に、未来の自分がゼロから再現できる粒度で書いてある。

## 0. 前提

- VPS（WebARENA Indigo 2GB、Ubuntu 24.04）を契約し、SSH鍵でログインできること
- ドメイン（サブドメイン可）の **Aレコードを VPS の IP に向けてあること**（Caddy の自動HTTPSに必須）
- 手元に `server/.env` の内容（AUTH_TOKEN / ANTHROPIC_API_KEY / GOOGLE_*）があること

以下、`{DOMAIN}` は自分のドメインに読み替える。

## 1. 初期設定（root で1回だけ）

```bash
# 専用ユーザー（sudo なし・最小権限）
adduser --disabled-password --gecos "" okabe

# deploy.sh が okabe サービスの再起動だけ sudo できるようにする
echo "okabe ALL=(root) NOPASSWD: /usr/bin/systemctl restart okabe, /usr/bin/systemctl is-active okabe" \
  > /etc/sudoers.d/okabe-restart
chmod 440 /etc/sudoers.d/okabe-restart

# ファイアウォール: SSH と HTTP/HTTPS のみ（8787 は 127.0.0.1 バインドなので元々外に出ないが二重で塞ぐ）
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

タイムゾーン: **ホストTZの設定は不要**。cron の Asia/Tokyo 解釈はコード側で明示している
（croner の `timezone` オプションと固定 UTC+9 のロジック。ホストTZ非依存であることはテストで担保）。
journalctl の表示を JST にしたければお好みで `timedatectl set-timezone Asia/Tokyo`。

## 2. Bun とアプリ（okabe ユーザーで）

```bash
su - okabe

# Bun
curl -fsSL https://bun.sh/install | bash
# ~/.bun/bin にインストールされる（systemd ユニットはこの絶対パスを使う）

# アプリ
git clone https://github.com/TaigaTinouchi/okabe.git
cd okabe/server
~/.bun/bin/bun install --frozen-lockfile
```

## 3. シークレット配置

ローカルの `server/.env` を持ち込む（内容は手元と同じで、モデルやcronだけ本番向けに調整）:

```bash
# 手元のMacから
scp server/.env okabe@{VPSのIP}:~/okabe/server/.env

# VPS側で権限を絞る（systemd の EnvironmentFile が読む）
chmod 600 ~/okabe/server/.env
```

Google の refresh token はローカルで取得済みのものがそのまま使える（IPに紐付かない）。

## 4. systemd サービス化（root で）

```bash
cp /home/okabe/okabe/deploy/okabe.service /etc/systemd/system/okabe.service
systemctl daemon-reload
systemctl enable --now okabe

# 確認
systemctl status okabe
journalctl -u okabe -f   # 起動ログに skills / jobs の登録が出る
curl -s http://127.0.0.1:8787/health   # {"ok":true}
```

マイグレーションは起動時に自動適用されるので個別の手順はない。

## 5. Caddy（HTTPS/WSS 終端、root で）

```bash
# 公式リポジトリからインストール
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Caddyfile 配置（deploy/Caddyfile の {あなたのドメイン} を置き換えて）
cp /home/okabe/okabe/deploy/Caddyfile /etc/caddy/Caddyfile
sed -i 's/{あなたのドメイン}/{DOMAIN}/' /etc/caddy/Caddyfile
systemctl reload caddy
```

確認（WebSocket の Upgrade が通ることまで見る）:

```bash
curl -s https://{DOMAIN}/health                     # {"ok":true} なら HTTPS 終端OK
curl -si -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGVzdA==" -H "Sec-WebSocket-Version: 13" \
  https://{DOMAIN}/ws                               # 401 が返れば WS 経路は通っている（認証前で正しい）
```

## 6. 配備直後にやること

1. **VPSのスナップショットを1枚取る**（Indigo管理画面。素の初期構築状態を保存して再構築を楽に）
2. クライアントを本番向きに再ビルド:
   ```bash
   # 手元のMacで
   make install-app AGENT_URL=https://{DOMAIN}
   ```
3. 動作確認チェックリスト:
   - [ ] アプリから会話 → ストリーミング応答が返る（wss経由）
   - [ ] アプリ終了 → `journalctl -u okabe` で通知等のイベント発生を確認 → アプリ再起動で catch-up 受信
   - [ ] `systemctl restart okabe` → 起動ログにジョブが**1回ずつ**再登録される（多重登録なし）
   - [ ] 翌朝 7:30 に予定サマリーが届く

## 7. 更新デプロイ（2回目以降）

```bash
# VPS上で
~/okabe/deploy/deploy.sh

# または手元のMacから1コマンド
make deploy OKABE_SSH=okabe@{DOMAIN}
```

## 8. バックアップとリストア

- 毎日 4:00 JST に `db-backup` ジョブが `server/data/backups/okabe-{曜日}.db` へスナップショット
  （7世代ローテーション。実行履歴は job_runs テーブル / journalctl で確認可能）
- リストア:
  ```bash
  systemctl stop okabe
  cp /home/okabe/okabe/server/data/backups/okabe-mon.db /home/okabe/okabe/server/data/okabe.db
  systemctl start okabe
  ```

## トラブルシューティング

- `journalctl -u okabe -n 100` — 起動失敗・ジョブエラー（`job_error` のJSON行）を確認
- LLMコスト確認: `journalctl -u okabe -o cat --since "7 days ago" | bun scripts/usage-report.ts`
- Google refresh token が失効した場合（`Google token refresh failed`）: ローカルで
  `bun scripts/google-auth.ts` を再実行し、新しい token を .env に反映して再起動
