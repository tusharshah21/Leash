// The one live test: real LLM, real devnet, and it costs a little of both. RUN_LLM=1 pnpm test:apps
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const run = (script: string) =>
  spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env }).status;

test("the demo ends with the expected scoreboard", { skip: !process.env.RUN_LLM }, () => {
  assert.equal(run("scripts/demo-fresh.ts"), 0);
  assert.equal(run("scripts/demo-run.ts"), 0);
});
