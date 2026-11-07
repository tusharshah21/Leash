import { strict as assert } from "node:assert";
import { test } from "node:test";
import { backoffMs, settledOr } from "../lib/retry.ts";

test("backoff doubles from one second and stops at thirty", () => {
  const top = (n: number) => backoffMs(n, () => 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(top), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(
    backoffMs(0, () => 0),
    500
  );
  assert.equal(
    backoffMs(9, () => 0),
    15000
  );
});

test("a failed part keeps its last good value", () => {
  const ok: PromiseSettledResult<number> = { status: "fulfilled", value: 2 };
  const failed: PromiseSettledResult<number> = { status: "rejected", reason: new Error("429") };
  assert.equal(settledOr(ok, 1), 2);
  assert.equal(settledOr(failed, 1), 1);
});

test("a failure with nothing to fall back on, or a fatal one, still throws", () => {
  const failed: PromiseSettledResult<number> = { status: "rejected", reason: new Error("gone") };
  assert.throws(() => settledOr(failed, undefined), /gone/);
  assert.throws(() => settledOr(failed, 1, () => true), /gone/);
});
