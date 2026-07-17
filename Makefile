# okabe 開発・ビルドタスク
#
# よく使うもの:
#   make dev          サーバー起動（server/.env を読む）
#   make install-app  macOSアプリをビルドして ~/Applications に配置
#   make test         全テスト / make check  lint+型チェック

# アプリに焼き込む接続先。VPS配備後は make install-app AGENT_URL=https://... で差し替え
AGENT_URL ?= http://localhost:8787
APP_BUNDLE = app/build/macos/Build/Products/Release/okabe_app.app

.PHONY: dev test check app run-app install-app usage deploy

## サーバーを開発モードで起動（--watch付き）
dev:
	cd server && bun run dev

## 全テスト（server + app）
test:
	cd server && bun test
	cd app && fvm flutter test

## lint + 型チェック + analyze
check:
	cd server && bun run check && ./node_modules/.bin/tsc --noEmit
	cd app && fvm flutter analyze

## macOSデスクトップアプリのリリースビルド
## AGENT_URL と server/.env の AUTH_TOKEN をビルド時に焼き込む
app:
	@test -f server/.env || { echo "server/.env がありません（AUTH_TOKEN が必要）"; exit 1; }
	cd app && fvm flutter build macos --release \
		--dart-define=AGENT_URL=$(AGENT_URL) \
		--dart-define=AGENT_TOKEN=$$(grep '^AUTH_TOKEN=' ../server/.env | cut -d= -f2)
	@echo "→ $(APP_BUNDLE)"

## ビルドして ~/Applications に「okabe.app」として配置（Spotlightから起動可能に）
install-app: app
	mkdir -p ~/Applications
	rm -rf ~/Applications/okabe.app
	cp -R "$(APP_BUNDLE)" ~/Applications/okabe.app
	@echo "✅ ~/Applications/okabe.app に配置しました"

## 開発実行（デバッグ・ホットリロード付き）
run-app:
	cd app && fvm flutter run -d macos \
		--dart-define=AGENT_URL=$(AGENT_URL) \
		--dart-define=AGENT_TOKEN=$$(grep '^AUTH_TOKEN=' ../server/.env | cut -d= -f2)

## LLMトークン消費の日別レポート（例: make usage < server.log）
usage:
	cd server && bun run usage

## 本番VPSへの更新デプロイ（例: make deploy OKABE_SSH=okabe@example.com）
deploy:
	@test -n "$(OKABE_SSH)" || { echo "OKABE_SSH=user@host を指定してください"; exit 1; }
	ssh $(OKABE_SSH) '~/okabe/deploy/deploy.sh'
