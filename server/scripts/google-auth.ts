/**
 * Google Calendar の初回 OAuth 認可（一度だけ実行する）。
 * GCP コンソール側の準備を含む全手順は README の「M3: Google カレンダー連携」を参照。
 *
 *   cd server && bun scripts/google-auth.ts
 *
 * ブラウザで認可すると refresh token が表示されるので .env に書き写す。
 */

const clientId = Bun.env.GOOGLE_CLIENT_ID;
const clientSecret = Bun.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を .env に設定してから実行してください");
  process.exit(1);
}

const PORT = 8789;
const redirectUri = `http://localhost:${PORT}/callback`;
const state = crypto.randomUUID();

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/calendar.readonly",
  access_type: "offline", // refresh token を得るために必須
  prompt: "consent", // 再認可でも必ず refresh token を返させる
  state,
}).toString();

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/callback") return new Response("not found", { status: 404 });
    if (url.searchParams.get("state") !== state) {
      return new Response("state mismatch", { status: 400 });
    }
    const code = url.searchParams.get("code");
    if (!code) return new Response(`認可エラー: ${url.searchParams.get("error")}`, { status: 400 });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const body = (await res.json()) as { refresh_token?: string; error?: string };
    if (!res.ok || !body.refresh_token) {
      console.error("token 交換に失敗:", JSON.stringify(body));
      setTimeout(() => process.exit(1), 100);
      return new Response("失敗しました。ターミナルを確認してください。", { status: 500 });
    }

    console.log("\n✅ 認可成功。以下を server/.env に追記してください:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${body.refresh_token}\n`);
    setTimeout(() => {
      server.stop();
      process.exit(0);
    }, 100);
    return new Response("認可完了。このタブは閉じてOKです。ターミナルに戻ってください。", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
});

console.log("ブラウザで以下の URL を開いて認可してください:\n");
console.log(authUrl.toString());
