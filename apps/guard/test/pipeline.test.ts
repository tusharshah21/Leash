// The whole pipeline with a mocked judge and chain. No LLM, no network.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  allowPda,
  IDL,
  mandatePda,
  PROGRAM_ID,
  reasonHash,
  vaultPda,
  vaultTokenPda,
} from "@leash/sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { Proposal } from "../src/decode.ts";
import { parseVerdict, type Verdict } from "../src/judge.ts";
import { cosign, type Deps, review, type Review } from "../src/pipeline.ts";
import type { ChainState, Decision } from "../src/rules.ts";

const agent = Keypair.generate();
const guardKey = Keypair.generate();
const vault = vaultPda(Keypair.generate().publicKey);
const mint = Keypair.generate().publicKey;
const vendor = Keypair.generate().publicKey;
const ctx = {
  programId: PROGRAM_ID,
  vault,
  mandate: mandatePda(vault),
  vaultToken: vaultTokenPda(vault),
  mint,
  agent: agent.publicKey,
  guard: guardKey.publicKey,
};
const proposal: Proposal = {
  recipient: vendor.toBase58(),
  amount: "120000000",
  memo: "INV-1",
  reasoning: "Pay INV-1",
};

function request(p = proposal) {
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(p.amount));
  const discriminator = (
    IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }
  ).instructions.find((i) => i.name === "agent_execute")!.discriminator;
  const key = (pubkey: PublicKey, isSigner = false) => ({
    pubkey,
    isSigner,
    isWritable: !isSigner,
  });
  const tx = new Transaction();
  tx.feePayer = agent.publicKey;
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      data: Buffer.concat([
        Buffer.from(discriminator),
        amount,
        Buffer.from(reasonHash(p.reasoning)),
      ]),
      keys: [
        key(agent.publicKey, true),
        key(guardKey.publicKey, true),
        key(vault),
        key(ctx.mandate),
        key(mint),
        key(ctx.vaultToken),
        key(getAssociatedTokenAddressSync(mint, vendor)),
        key(allowPda(vault, vendor)),
        key(TOKEN_PROGRAM_ID),
      ],
    })
  );
  tx.partialSign(agent);
  return {
    userTask: "Pay CloudHost Inc 120 dUSDC",
    proposal: p,
    serializedTx: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  };
}

const APPROVE: Verdict = { verdict: "approve", risk: 5, rationale: "matches the task" };
const OK_STATE: ChainState = { paused: false, expired: false, allowlisted: true, tier: "MEDIUM" };

function harness(judge: Deps["judge"], state = OK_STATE, overrides: Partial<Deps> = {}) {
  const log: Decision[] = [];
  const judged: unknown[] = [];
  const deps: Deps = {
    ctx,
    guardKey,
    chainState: async () => state,
    vendors: async () => [{ name: "CloudHost Inc", address: vendor.toBase58() }],
    judge: (input) => {
      judged.push(input);
      return judge(input);
    },
    history: () => log,
    record: (d) => void log.push(d),
    pendingAction: async () => ({
      recipient: vendor,
      amount: BigInt(proposal.amount),
      reasonHash: reasonHash(proposal.reasoning),
    }),
    recordReview: () => {},
    ...overrides,
  };
  return { deps, log, judged };
}

const guardSigned = (signedTx: string) => {
  const tx = Transaction.from(Buffer.from(signedTx, "base64"));
  return tx.signatures.find((s) => s.publicKey.equals(guardKey.publicKey))?.signature !== null;
};

test("approve returns a tx signed by the guard and logs it", async () => {
  const { deps, log } = harness(async () => APPROVE);
  const res = await cosign(request(), deps);
  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.ok(guardSigned(res.signedTx));
  assert.equal(log[0].decision, "approve");
});

test("judge deny returns 403 with its rationale and no signature", async () => {
  const { deps, log } = harness(async () => ({ verdict: "deny", risk: 90, rationale: "inflated" }));
  const res = await cosign(request(), deps);
  assert.equal(res.status, 403);
  assert.equal(res.verdict, "deny");
  assert.ok(!("signedTx" in res));
  assert.equal(res.rationale, "inflated");
  assert.equal(log[0].stage, "judge");
});

test("a throwing or malformed judge fails closed", async () => {
  const { deps } = harness(async () => {
    throw new Error("OpenAI is down");
  });
  const res = await cosign(request(), deps);
  assert.equal(res.verdict, "deny");
  assert.ok(!("signedTx" in res));
  assert.throws(() => parseVerdict('{"verdict":"yes","risk":1,"rationale":"x"}'));
  assert.throws(() => parseVerdict('{"verdict":"approve","risk":900,"rationale":"x"}'));
  assert.throws(() => parseVerdict("not json"));
});

test("duplicates are refused before the judge, per vault", async () => {
  const { deps, judged } = harness(async () => APPROVE);
  assert.equal((await cosign(request(), deps)).status, 200);
  const again = await cosign(request({ ...proposal, memo: "  inv-1 " }), deps);
  assert.equal(again.status, 403);
  assert.match(again.status === 403 ? again.rationale : "", /duplicate/);
  assert.equal(judged.length, 1);

  const other = harness(async () => APPROVE);
  const elsewhere: Decision = {
    ts: new Date().toISOString(),
    vault: Keypair.generate().publicKey.toBase58(),
    recipient: proposal.recipient,
    amount: proposal.amount,
    memo: proposal.memo,
    decision: "approve",
    stage: "sign",
  };
  other.log.push(elsewhere);
  assert.equal((await cosign(request(), other.deps)).status, 200);
});

test("the same amount under a new memo is a duplicate within a task, not across tasks", async () => {
  const { deps, judged } = harness(async () => APPROVE);
  assert.equal((await cosign(request(), deps)).status, 200);
  const renamed = { ...proposal, memo: "INV-1-CORRECTION" };
  const retry = await cosign(request(renamed), deps);
  assert.equal(retry.status, 403);
  assert.match(retry.status === 403 ? retry.rationale : "", /duplicate/);
  assert.equal(judged.length, 1);

  const nextWeek = { ...request(renamed), userTask: "Pay next week's CloudHost Inc 120 dUSDC" };
  assert.equal((await cosign(nextWeek, deps)).status, 200);
});

test("old and denied decisions do not count as duplicates", async () => {
  const { deps, log } = harness(async () => APPROVE);
  const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
  const same = {
    vault: vault.toBase58(),
    recipient: proposal.recipient,
    amount: proposal.amount,
    memo: proposal.memo,
  };
  log.push({ ...same, ts: old, decision: "approve", stage: "sign" });
  log.push({ ...same, ts: new Date().toISOString(), decision: "deny", stage: "judge" });
  assert.equal((await cosign(request(), deps)).status, 200);
});

test("chain rules refuse before the judge", async () => {
  for (const [state, pattern] of [
    [{ ...OK_STATE, paused: true }, /paused/],
    [{ ...OK_STATE, expired: true }, /expired/],
    [{ ...OK_STATE, allowlisted: false }, /allowlist/],
    [{ ...OK_STATE, tier: "HIGH" }, /human approval/],
  ] as [ChainState, RegExp][]) {
    const { deps, judged } = harness(async () => APPROVE, state);
    const res = await cosign(request(), deps);
    assert.equal(res.status, 403);
    assert.match(res.status === 403 ? res.rationale : "", pattern);
    assert.equal(judged.length, 0);
  }
});

test("the judge never sees anything but the task, proposal and vendors", async () => {
  const { deps, judged } = harness(async () => APPROVE);
  await cosign(request(), deps);
  assert.deepEqual(Object.keys(judged[0] as object).sort(), ["proposal", "userTask", "vendors"]);
  assert.equal((judged[0] as { proposal: { amountDusdc: string } }).proposal.amountDusdc, "120");
});

test("a tampered transaction is refused before anything else runs", async () => {
  const { deps, judged, log } = harness(async () => APPROVE);
  const res = await cosign({ ...request(), proposal: { ...proposal, amount: "190000000" } }, deps);
  assert.equal(res.verdict, "deny");
  assert.equal(judged.length, 0);
  assert.equal(log[0].stage, "decode");
});

test("malformed requests are refused and an unloggable approval is never returned", async () => {
  const { deps } = harness(async () => APPROVE);
  assert.equal((await cosign({}, deps)).verdict, "deny");
  assert.equal((await cosign(null, deps)).verdict, "deny");
  const long = { ...request(), userTask: "x".repeat(2001) };
  assert.equal((await cosign(long, deps)).verdict, "deny");

  const broken = harness(async () => APPROVE, OK_STATE, {
    record: () => {
      throw new Error("disk full");
    },
  });
  const res = await cosign(request(), broken.deps);
  assert.equal(res.status, 500);
  assert.ok(!("signedTx" in res));
});

const reviewBody = { userTask: "Pay DataLabs 120", proposal, nonce: "3" };

test("review reports risk and rule findings for a matching proposal, and signs nothing", async () => {
  const reviews: Review[] = [];
  const { deps, log, judged } = harness(
    async () => ({ verdict: "deny", risk: 95, rationale: "not in the task" }),
    { ...OK_STATE, allowlisted: false, tier: "HIGH" },
    { recordReview: (r) => void reviews.push(r) }
  );
  const res = await review(reviewBody, deps);
  assert.equal(res.status, 200);
  assert.ok(!("signedTx" in res));
  assert.deepEqual(res.status === 200 && res.findings, ["recipient is not on the allowlist"]);
  assert.equal(reviews[0].nonce, "3");
  assert.equal(reviews[0].risk, 95);
  assert.equal(judged.length, 1);
  assert.equal(log.length, 0);
});

test("review refuses a proposal that does not match the chain, or does not exist", async () => {
  const { deps, judged } = harness(async () => APPROVE);
  for (const change of [
    { amount: "1" },
    { reasoning: "something else" },
    { recipient: Keypair.generate().publicKey.toBase58() },
  ]) {
    const res = await review({ ...reviewBody, proposal: { ...proposal, ...change } }, deps);
    assert.equal(res.status, 403);
  }
  assert.equal(judged.length, 0);

  const missing = harness(async () => APPROVE, OK_STATE, { pendingAction: async () => null });
  assert.equal((await review(reviewBody, missing.deps)).status, 403);
  assert.equal((await review({ ...reviewBody, nonce: "x" }, deps)).status, 403);
});

test("an approving review never makes a later payment a duplicate", async () => {
  const lines: unknown[] = [];
  const { deps } = harness(async () => APPROVE, OK_STATE, {
    recordReview: (r) => void lines.push(r),
    history: () => lines as Decision[],
  });
  assert.equal((await review(reviewBody, deps)).status, 200);
  assert.equal(lines.length, 1);
  assert.equal((await cosign(request(), deps)).status, 200);
});
