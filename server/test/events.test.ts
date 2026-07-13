import { describe, expect, test } from "bun:test";
import { createDb } from "../src/store/db";
import { EventStore } from "../src/store/events";

function makeStore() {
  return new EventStore(createDb(":memory:"));
}

describe("EventStore", () => {
  test("append は単調増加の id と ts を振る", () => {
    const store = makeStore();
    const a = store.append("user_message", { text: "one" });
    const b = store.append("assistant_message", { text: "two" });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(a.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("listAfter は指定 id より後を昇順で返す", () => {
    const store = makeStore();
    store.append("user_message", { text: "one" });
    const b = store.append("assistant_message", { text: "two" });
    const c = store.append("notification", { text: "three" });

    const after1 = store.listAfter(1);
    expect(after1.map((e) => e.id)).toEqual([b.id, c.id]);
    expect(store.listAfter(0)).toHaveLength(3);
    expect(store.listAfter(c.id)).toHaveLength(0);
  });
});
