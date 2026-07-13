import { describe, expect, test } from "bun:test";
import { parseClientMessage } from "../src/protocol";

describe("parseClientMessage", () => {
  test("有効な user_message を受理する", () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: "user_message", payload: { text: "hello" } }),
    );
    expect(msg).toEqual({ type: "user_message", payload: { text: "hello" } });
  });

  test("JSON でない入力は null", () => {
    expect(parseClientMessage("not json")).toBeNull();
  });

  test("未知の type は null", () => {
    expect(parseClientMessage(JSON.stringify({ type: "evil", payload: { text: "x" } }))).toBeNull();
  });

  test("空文字の text は null", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "user_message", payload: { text: "" } })),
    ).toBeNull();
  });
});
