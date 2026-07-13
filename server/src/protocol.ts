import { z } from "zod";

/**
 * ワイヤプロトコルの定義。ここが client / server 間の契約の正。
 *
 * - client → server: `clientMessageSchema`
 * - server → client: `serverEventSchema`（events テーブルの1行がそのまま配送単位）
 *   例外として、永続化しない一時フレーム `transientErrorSchema` がある
 */

export const clientMessageSchema = z.object({
  type: z.literal("user_message"),
  payload: z.object({
    text: z.string().min(1).max(8_000),
  }),
});

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const eventTypeSchema = z.enum(["user_message", "assistant_message", "notification"]);

export type EventType = z.infer<typeof eventTypeSchema>;

export const serverEventSchema = z.object({
  id: z.number().int().positive(),
  type: eventTypeSchema,
  ts: z.string(),
  payload: z.object({
    text: z.string(),
  }),
});

export type ServerEvent = z.infer<typeof serverEventSchema>;

/** 検証エラー等、履歴に残す価値のない一時フレーム（id を持たない） */
export const transientErrorSchema = z.object({
  type: z.literal("error"),
  payload: z.object({
    message: z.string(),
  }),
});

export type TransientError = z.infer<typeof transientErrorSchema>;

/**
 * アシスタント応答のストリーミング断片。永続化せず、接続中のクライアントにのみ流す。
 * 全文は最後に assistant_message イベントとして受信箱に載るため、
 * 取りこぼしても catch-up で完全な形が手に入る（ADR-0003 の原則そのまま）
 */
export const transientDeltaSchema = z.object({
  type: z.literal("assistant_delta"),
  payload: z.object({
    text: z.string(),
  }),
});

export type TransientDelta = z.infer<typeof transientDeltaSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = clientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}
