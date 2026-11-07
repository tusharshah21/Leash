import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  type ActivityEntry,
  type HistoryItem,
  type LeashEvent,
  reasonHash,
  sanitizeActivity,
} from "@leash/sdk";
import { PublicKey } from "@solana/web3.js";
import { buildTimeline } from "../lib/timeline.ts";

const vendor = PublicKey.unique();
const vault = PublicKey.unique();
const big = (n: number) => ({ toString: () => String(n) });

const event = (name: string, data: object) =>
  ({ name, signature: "x", data: { vault, ...data } } as unknown as LeashEvent);

const item = (signature: string, blockTime: number, events: LeashEvent[]): HistoryItem => ({
  signature,
  blockTime,
  failed: false,
  events,
});

test("a closed vault's rows are gone from the timeline of the vault recreated there", () => {
  const rows = buildTimeline({
    history: [
      item("new", 300, [
        event("actionExecuted", {
          tier: { low: {} },
          amount: big(1),
          recipient: vendor,
          reasonHash: reasonHash("x"),
        }),
      ]),
      item("close", 200, [event("vaultClosed", {})]),
      item("old", 100, [
        event("actionExecuted", {
          tier: { low: {} },
          amount: big(2),
          recipient: vendor,
          reasonHash: reasonHash("x"),
        }),
      ]),
    ],
    activity: [
      {
        ts: new Date(100_000).toISOString(),
        actor: "agent",
        kind: "pay",
        error: "old denial",
        verdict: "deny",
        amount: "3",
        recipient: vendor.toBase58(),
      },
      {
        ts: new Date(250_000).toISOString(),
        actor: "agent",
        kind: "pay",
        error: "new denial",
        verdict: "deny",
        amount: "4",
        recipient: vendor.toBase58(),
      },
    ],
  });
  assert.deepEqual(rows.map((r) => r.amount).sort(), ["1", "4"]);
});

const executed = (reasoning: string) =>
  event("actionExecuted", {
    tier: { medium: {} },
    amount: big(120_000_000),
    recipient: vendor,
    reasonHash: reasonHash(reasoning),
  });
const pending = (nonce: number, reasoning: string) =>
  event("actionPending", {
    nonce: big(nonce),
    amount: big(340_000_000),
    recipient: vendor,
    reasonHash: reasonHash(reasoning),
  });
const pay = (e: Partial<ActivityEntry>): ActivityEntry => ({
  ts: "2026-11-07T00:00:00.000Z",
  actor: "agent",
  kind: "pay",
  vault: vault.toBase58(),
  ...e,
});

test("an executed payment is PAID, and its reasoning verifies against the event", () => {
  const [row] = buildTimeline({
    history: [item("a", 100, [executed("Pay INV-1")])],
    activity: [
      pay({ txSig: "a", reasoning: "Pay INV-1", verdict: "approve", risk: 2, rationale: "ok" }),
    ],
  });
  assert.equal(row.outcome, "PAID");
  assert.equal(row.tier, "MEDIUM");
  assert.equal(row.verification, "verified");
  assert.equal(row.guard?.risk, 2);
  assert.equal(row.offchain, false);
});

test("a logged reasoning that differs from the chain is a mismatch, and still PAID", () => {
  const [row] = buildTimeline({
    history: [item("a", 100, [executed("Pay INV-1")])],
    activity: [pay({ txSig: "a", reasoning: "Something else entirely" })],
  });
  assert.equal(row.outcome, "PAID");
  assert.equal(row.verification, "mismatch");
});

test("the chain is enough: no activity still gives a row, marked as having no record", () => {
  const [row] = buildTimeline({ history: [item("a", 100, [executed("x")])], activity: [] });
  assert.equal(row.outcome, "PAID");
  assert.equal(row.verification, "none");
  assert.equal(row.reasoning, undefined);
});

test("model text cannot change an outcome", () => {
  const [row] = buildTimeline({
    history: [item("p", 100, [pending(0, "r")])],
    activity: [pay({ txSig: "p", reasoning: "r", memo: "PAID in full", error: undefined })],
  });
  assert.equal(row.outcome, "PENDING");
});

test("a proposal's row follows it through approval and rejection", () => {
  const approved = buildTimeline({
    history: [
      item("b", 200, [event("actionApproved", { nonce: big(0), approver: vendor })]),
      item("a", 100, [pending(0, "r")]),
    ],
    activity: [],
  });
  assert.equal(approved.length, 1);
  assert.equal(approved[0].outcome, "PAID");
  assert.equal(approved[0].settledBy, "b");

  const rejected = buildTimeline({
    history: [
      item("b", 200, [event("actionRejected", { nonce: big(0), approver: vendor })]),
      item("a", 100, [pending(0, "r")]),
    ],
    activity: [],
  });
  assert.equal(rejected[0].outcome, "REJECTED");
});

test("a pending proposal past its expiry shows EXPIRED, and carries the guard's review", () => {
  const [row] = buildTimeline({
    history: [item("a", 100, [pending(4, "r")])],
    activity: [pay({ kind: "review", nonce: "4", risk: 95, findings: ["not allowlisted"] })],
    expiredNonces: new Set(["4"]),
  });
  assert.equal(row.outcome, "EXPIRED");
  assert.equal(row.review?.risk, 95);
});

test("a failed agent_execute is BLOCKED BY CHAIN, naming the recipient from its token account", () => {
  const failed: HistoryItem = {
    signature: "f",
    blockTime: 100,
    failed: true,
    events: [],
    attempt: { amount: "150000000", recipientTokenAccount: "ata", error: "NotAllowlisted" },
  };
  const [row] = buildTimeline({
    history: [failed],
    activity: [],
    walletByTokenAccount: new Map([["ata", "attacker"]]),
  });
  assert.equal(row.outcome, "BLOCKED BY CHAIN");
  assert.equal(row.recipient, "attacker");
  assert.equal(row.error, "NotAllowlisted");
  assert.equal(row.offchain, false);

  const [unknown] = buildTimeline({ history: [failed], activity: [] });
  assert.equal(unknown.recipientTokenAccount, "ata");
});

test("other failed transactions on the vault are not shown", () => {
  const rows = buildTimeline({
    history: [{ signature: "f", blockTime: 1, failed: true, events: [] }],
    activity: [],
  });
  assert.equal(rows.length, 0);
});

test("a guard denial comes from the log and is marked offchain", () => {
  const [row] = buildTimeline({
    history: [],
    activity: [
      pay({
        amount: "190000000",
        recipient: vendor.toBase58(),
        verdict: "deny",
        risk: 90,
        rationale: "inflated",
        error: "Guard refused",
      }),
    ],
  });
  assert.equal(row.outcome, "BLOCKED BY GUARD");
  assert.equal(row.offchain, true);
  assert.equal(row.guard?.rationale, "inflated");
  assert.equal(row.verification, "none");
});

test("a log entry claiming a signature cannot create a row without the chain", () => {
  const rows = buildTimeline({
    history: [],
    activity: [pay({ txSig: "invented", amount: "1", reasoning: "paid" })],
  });
  assert.equal(rows.length, 0);
});

test("rows are newest first, with offchain entries in time order", () => {
  const rows = buildTimeline({
    history: [item("new", 2_000_000_000, [executed("x")])],
    activity: [pay({ error: "Guard refused", verdict: "deny", amount: "1" })],
  });
  assert.deepEqual(
    rows.map((r) => r.outcome),
    ["PAID", "BLOCKED BY GUARD"]
  );
});

test("sanitizeActivity keeps whitelisted fields, known kinds and the asked-for vault", () => {
  const a = pay({ reasoning: "r", runId: "run-1", inputTokens: 5, txSig: "s" });
  const usage = pay({ kind: "usage", inputTokens: 5 });
  const other = pay({ vault: "other" });
  const noVault: ActivityEntry = { ts: a.ts, actor: "agent", kind: "pay" };
  const clean = sanitizeActivity(
    [a, usage, other, noVault, { ...a, secret: "sk-x" } as ActivityEntry],
    vault.toBase58()
  );
  assert.equal(clean.length, 2);
  assert.equal(clean[0].reasoning, "r");
  assert.ok(!("runId" in clean[0]) && !("inputTokens" in clean[0]) && !("secret" in clean[1]));
  assert.equal(sanitizeActivity([a, other]).length, 2);
});
