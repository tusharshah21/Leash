import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isDuplicate, splitByVault } from "../src/rules.ts";

const line = (vault: string) =>
  JSON.stringify({
    ts: new Date().toISOString(),
    vault,
    decision: "approve",
    recipient: "R",
    amount: "1",
    memo: "m",
  });

test("clears only the named vault, and keeps what it cannot read", () => {
  const lines = [line("A"), line("B"), "not json", "", line("A")];
  const { keep, removed } = splitByVault(lines, "A");
  assert.equal(removed.length, 2);
  assert.deepEqual(keep, [lines[1], "not json"]);
});

test("after a reset the same payment is no longer a duplicate on that vault only", () => {
  const history = [line("A"), line("B")];
  const payment = (vault: string) => ({
    vault,
    recipient: "R",
    amount: "1",
    memo: "m",
    userTask: "t",
  });
  const now = Date.now();
  const parsed = (ls: string[]) => ls.map((l) => JSON.parse(l));
  assert.equal(isDuplicate(parsed(history), payment("A"), now), true);
  const { keep } = splitByVault(history, "A");
  assert.equal(isDuplicate(parsed(keep), payment("A"), now), false);
  assert.equal(isDuplicate(parsed(keep), payment("B"), now), true);
});
