import type { ServerEvent } from "../protocol";

/**
 * 配送チャネルの縫い目（ADR-0003）。
 * イベントは永続化された後にここへ渡る。配送は best effort でよく、
 * 失敗してもイベントは失われない（クライアントが catch-up で回収する）。
 * 将来の CLI / Web / FCM はこのインターフェースの実装を1つ足すだけ。
 */
export interface Channel {
  readonly name: string;
  deliver(event: ServerEvent): Promise<void> | void;
}
