import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * 静的 Bearer トークン認証（ADR-0006）。
 * `Authorization: Bearer <token>` ヘッダーのみを受け付ける。
 * クエリパラメータでのトークン受け渡しは、リバースプロキシのアクセスログに
 * URLごと平文で残るため廃止した（VPS配備フェーズの残修正）。
 * トークン値はログに出さない。
 */
export function bearerAuth(expectedToken: string): MiddlewareHandler {
  const expected = Buffer.from(expectedToken);
  return async (c, next) => {
    const header = c.req.header("authorization");
    const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!provided || !safeEqual(Buffer.from(provided), expected)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
