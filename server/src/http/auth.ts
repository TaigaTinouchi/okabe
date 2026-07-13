import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * 静的 Bearer トークン認証（ADR-0006）。
 * `Authorization: Bearer <token>` を基本とし、WebSocket をブラウザから張る将来のために
 * `?token=` クエリも受け付ける。トークン値はログに出さない。
 */
export function bearerAuth(expectedToken: string): MiddlewareHandler {
  const expected = Buffer.from(expectedToken);
  return async (c, next) => {
    const header = c.req.header("authorization");
    const fromHeader = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const provided = fromHeader ?? c.req.query("token");
    if (!provided || !safeEqual(Buffer.from(provided), expected)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
