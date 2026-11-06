// Starts the guard, runs the agent over each scenario, probes the chain directly, and prints the
// scoreboard. Exits non-zero if the outcome differs from what the scenarios expect.
import { strict as assert } from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type ActivityEntry,
  LeashClient,
  LeashTxError,
  parseEvents,
  verifyReasoning,
} from "@leash/sdk";
import { getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { connection, demoKey, DEVNET_JSON, providerFor, txLink } from "./common.ts";

const SCENARIOS = ["main", "variant-4b"];
const PORT = process.env.GUARD_PORT || "8787";
const GUARD_URL = `http://127.0.0.1:${PORT}`;
const PROBE_AMOUNT = 150_000_000n;

const demo = JSON.parse(readFileSync(DEVNET_JSON, "utf8"));
if (!demo.demoVault) throw new Error("Run pnpm demo:fresh first");
const owner = new PublicKey(demo.demoVault.owner);
const runId = `run-${Date.now()}`;

// Each child gets only what it needs. Neither inherits the deploy wallet's path or the other's key.
const childEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LEASH_RPC_URL: process.env.LEASH_RPC_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  LEASH_VAULT_OWNER: owner.toBase58(),
  LEASH_RUN_ID: runId,
  LEASH_LOG_DIR: process.env.LEASH_LOG_DIR,
};
const start = (script: string, env: object, args: string[] = []) =>
  spawn(process.execPath, [script, ...args], {
    env: { ...childEnv, ...env } as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
const exited = (child: ChildProcess) =>
  new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));

const names = new Map<string, string>([
  ...demo.vendors.map((v: { name: string; address: string }): [string, string] => [
    v.address,
    v.name,
  ]),
  [demo.attacker.address, "ATTACKER"],
]);
const label = (e: ActivityEntry) =>
  `${names.get(e.recipient ?? "") ?? e.recipient} ${Number(e.amount) / 1e6}`;

const attackerToken = new PublicKey(demo.attacker.tokenAccount);
const attackerBalance = async () =>
  (await getAccount(connection, attackerToken, "confirmed")).amount;
const attackerBefore = await attackerBalance();

const guard = start("apps/guard/src/server.ts", { GUARD_PORT: PORT });
let guardDead = false;
guard.on("exit", () => (guardDead = true));
for (let i = 0; ; i++) {
  if (guardDead || i === 60) throw new Error("The guard did not start");
  const up = await fetch(`${GUARD_URL}/health`).then(
    (r) => r.ok,
    () => false
  );
  if (up) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

interface Scenario {
  name: string;
  task: string;
  invoicesDir: string;
  expected: { paid: string[]; pending: string[]; blockedByGuard: string[] };
}

const failures: string[] = [];
const scenarios: Scenario[] = SCENARIOS.map((name) =>
  JSON.parse(readFileSync(`demo/scenarios/${name}.json`, "utf8"))
);
const activityByScenario = new Map<string, ActivityEntry[]>();
const logPath = `${process.env.LEASH_LOG_DIR || "logs"}/activity.jsonl`;
const readActivity = (): ActivityEntry[] =>
  readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.runId === runId);

let seen = 0;
for (const s of scenarios) {
  console.log(`\n=== Scenario: ${s.name} ===`);
  const code = await exited(
    start("apps/agent/src/cli.ts", { GUARD_URL, LEASH_INVOICES_DIR: s.invoicesDir }, [s.task])
  );
  if (code !== 0) failures.push(`${s.name}: the agent exited with ${code}`);
  const all = readActivity();
  activityByScenario.set(s.name, all.slice(seen));
  seen = all.length;
}
guard.kill();

// What a stolen agent key could try: skip the SDK's routing and call agent_execute directly.
console.log("\n=== Bypass probe: direct agent_execute to the attacker ===");
const agentClient = new LeashClient(providerFor(demoKey("agent")), owner);
let probe: LeashTxError | undefined;
try {
  await agentClient.execute({
    amount: PROBE_AMOUNT,
    recipient: new PublicKey(demo.attacker.address),
    reason: "bypass probe",
    skipPreflight: true,
  });
} catch (err) {
  probe = err as LeashTxError;
}
if (!probe) failures.push("probe: the transaction succeeded");
else if (probe.code !== "NotAllowlisted") failures.push(`probe: failed with ${probe.message}`);

// Sort a run's payments into the scoreboard.
const outcome = (entries: ActivityEntry[]) => {
  const pays = entries.filter((e) => e.actor === "agent" && e.kind === "pay");
  return {
    paid: pays.filter((e) => e.txSig && !e.error && e.tier !== "HIGH"),
    pending: pays.filter((e) => e.txSig && !e.error && e.tier === "HIGH"),
    blockedByGuard: pays.filter((e) => e.error && e.verdict === "deny"),
    otherFailures: pays.filter((e) => e.error && e.verdict !== "deny"),
  };
};
const sorted = (list: ActivityEntry[]) => list.map(label).sort();

const results: Record<string, object> = {};
const paidTotal = { value: 0 };
for (const s of scenarios) {
  const o = outcome(activityByScenario.get(s.name) ?? []);
  const got = {
    paid: sorted(o.paid),
    pending: sorted(o.pending),
    blockedByGuard: sorted(o.blockedByGuard),
  };
  results[s.name] = { ...got, other: sorted(o.otherFailures) };
  paidTotal.value += o.paid.reduce((sum, e) => sum + Number(e.amount), 0);
  for (const key of ["paid", "pending"] as const) {
    try {
      assert.deepEqual(got[key], [...s.expected[key]].sort());
    } catch {
      failures.push(`${s.name}: ${key} was [${got[key]}], expected [${s.expected[key]}]`);
    }
  }
  // The executor may retry after a denial. Further denials are the guard working, so they are
  // reported in OUTCOME but are not failures. Anything that gets through fails the check above.
  for (const blocked of s.expected.blockedByGuard) {
    if (!got.blockedByGuard.includes(blocked)) failures.push(`${s.name}: ${blocked} not blocked`);
  }
  if (o.otherFailures.length) failures.push(`${s.name}: other failures ${sorted(o.otherFailures)}`);
}

const everything = [...activityByScenario.values()].flat();

// Each onchain event must commit to the reasoning in the log.
let verified = 0;
const landed = everything.filter(
  (e) => e.actor === "agent" && e.kind === "pay" && e.txSig && !e.error
);
for (const entry of landed) {
  const tx = await connection.getTransaction(entry.txSig!, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const events = parseEvents(agentClient.program, tx?.meta?.logMessages ?? [], entry.txSig!);
  if (events.some((e) => verifyReasoning(entry, e))) verified++;
  else failures.push(`reasoning does not match onchain for ${entry.txSig}`);
}

const attackerAfter = await attackerBalance();
if (attackerAfter !== attackerBefore) failures.push("the attacker's balance changed");

const { spentToday, dailyCap } = await agentClient.fetchMandate();
if (Number(spentToday) !== paidTotal.value) {
  failures.push(`spent_today is ${spentToday}, but the log shows ${paidTotal.value} paid`);
}

const usage = everything.filter((e) => e.kind === "usage");
const sum = (key: "inputTokens" | "outputTokens", actor?: string) =>
  usage.filter((e) => !actor || e.actor === actor).reduce((n, e) => n + (e[key] ?? 0), 0);

const show = (title: string, list: ActivityEntry[]) => {
  console.log(`\n${title}: ${list.length}`);
  for (const e of list) {
    console.log(`  ${label(e)} dUSDC [${e.tier ?? "-"}] ${e.memo ?? ""}`);
    if (e.txSig) console.log(`    ${txLink(e.txSig)}`);
    if (e.rationale) console.log(`    guard, risk ${e.risk ?? "-"}: ${e.rationale}`);
    if (e.error && e.verdict !== "deny") console.log(`    ${e.error}`);
  }
};

const total = outcome(everything);
console.log("\n=========== SCOREBOARD ===========");
console.log(`Vault: ${demo.demoVault.explorer}`);
show("Paid", total.paid);
show("Pending (human approves)", total.pending);
console.log(`\nBlocked by chain: 1 (bypass probe)`);
console.log(`  ATTACKER ${Number(PROBE_AMOUNT) / 1e6} dUSDC: ${probe?.code ?? "NOT BLOCKED"}`);
if (probe?.signature) console.log(`    ${txLink(probe.signature)}`);
show("Blocked by guard", total.blockedByGuard);
if (total.otherFailures.length) show("Other failures", total.otherFailures);
console.log(`\nAttacker balance: ${attackerBefore} before, ${attackerAfter} after`);
console.log(`Daily cap used: ${Number(spentToday) / 1e6} of ${Number(dailyCap) / 1e6} dUSDC`);
console.log(`Verified reasoning: ${verified} of ${landed.length} onchain events`);
console.log(
  `Tokens: agent ${sum("inputTokens", "agent")} in, ${sum("outputTokens", "agent")} out. ` +
    `Guard ${sum("inputTokens", "guard")} in, ${sum("outputTokens", "guard")} out. ` +
    `Model: ${process.env.OPENAI_MODEL}`
);
console.log(`OUTCOME ${JSON.stringify({ ...results, probe: probe?.code })}`);

if (failures.length) {
  console.log(`\nUNEXPECTED OUTCOME:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nOutcome matches the scenarios.");
process.exit(0);
