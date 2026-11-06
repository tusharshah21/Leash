// The guard pipeline, in order: decode, rules, judge, sign. Any error refuses without a signature.
// `review` is the advisory path for proposals. It has no signing step.
import { createHash } from "node:crypto";
import { type Keypair, PublicKey } from "@solana/web3.js";
import { type DecodeContext, decodeAndVerify, parseAmount, type Proposal } from "./decode.ts";
import type { Judge, Verdict } from "./judge.ts";
import { type ChainState, type Decision, isDuplicate, ruleViolation } from "./rules.ts";

export interface CosignRequest {
  userTask: string;
  proposal: Proposal;
  serializedTx: string;
}

export interface Deps {
  ctx: DecodeContext;
  guardKey: Keypair;
  chainState(recipient: PublicKey, amount: bigint): Promise<ChainState>;
  vendors(): Promise<{ name: string; address: string }[]>;
  judge: Judge;
  history(): Decision[];
  /** Must throw if the decision cannot be stored, so nothing is ever signed unlogged. */
  record(decision: Decision): void;
  /** The onchain proposal, or null if there is no such account. */
  pendingAction(
    nonce: bigint
  ): Promise<{ recipient: PublicKey; amount: bigint; reasonHash: number[] } | null>;
  recordReview(review: Review): void;
}

export interface Review {
  ts: string;
  kind: "review";
  vault: string;
  nonce: string;
  recipient: string;
  amount: string;
  memo: string;
  verdict: Verdict["verdict"];
  risk: number;
  rationale: string;
  findings: string[];
}

export type ReviewResult =
  | {
      status: 200;
      verdict: Verdict["verdict"];
      risk: number;
      rationale: string;
      findings: string[];
    }
  | { status: 403; rationale: string };

/**
 * Reviews a payment already proposed onchain, for the human who decides it. Advisory: it signs
 * nothing, and its log lines have no `decision`, so they never count as duplicates.
 */
export async function review(body: unknown, deps: Deps): Promise<ReviewResult> {
  try {
    const { userTask, proposal, nonce } = body as CosignRequest & { nonce: string };
    if (typeof nonce !== "string" || !/^[0-9]{1,20}$/.test(nonce)) throw new Error("bad nonce");
    checkShape({ userTask, proposal, serializedTx: "unused" });

    const amount = parseAmount(proposal.amount);
    const recipient = new PublicKey(proposal.recipient);
    const pending = await deps.pendingAction(BigInt(nonce));
    if (!pending) throw new Error("no such proposal onchain");
    const hash = createHash("sha256").update(proposal.reasoning).digest();
    const matches =
      pending.recipient.equals(recipient) &&
      pending.amount === amount &&
      hash.equals(Buffer.from(pending.reasonHash));
    if (!matches) throw new Error("proposal does not match the onchain account");

    const violation = ruleViolation(await deps.chainState(recipient, amount));
    const vendors = await deps.vendors();
    const verdict = await deps.judge({
      userTask,
      proposal: judgeView(proposal, amount, vendors),
      vendors,
    });
    const findings = violation ? [violation] : [];
    deps.recordReview({
      ts: new Date().toISOString(),
      kind: "review",
      vault: deps.ctx.vault.toBase58(),
      nonce,
      recipient: proposal.recipient,
      amount: proposal.amount,
      memo: proposal.memo,
      ...verdict,
      findings,
    });
    return { status: 200, ...verdict, findings };
  } catch (err) {
    return { status: 403, rationale: String((err as Error)?.message ?? err) };
  }
}

export type CosignResult =
  | { status: 200; signedTx: string; verdict: "approve"; risk: number; rationale: string }
  | {
      status: 400 | 403 | 500;
      verdict: "deny";
      stage: Decision["stage"];
      rationale: string;
      risk?: number;
    };

const MAX = { userTask: 2000, memo: 200, reasoning: 2000, serializedTx: 4096 };

function checkShape(body: unknown): asserts body is CosignRequest {
  const b = body as CosignRequest;
  const fields = [
    [b?.userTask, MAX.userTask, "userTask"],
    [b?.serializedTx, MAX.serializedTx, "serializedTx"],
    [b?.proposal?.recipient, 64, "proposal.recipient"],
    [b?.proposal?.amount, 32, "proposal.amount"],
    [b?.proposal?.memo, MAX.memo, "proposal.memo"],
    [b?.proposal?.reasoning, MAX.reasoning, "proposal.reasoning"],
  ] as const;
  for (const [value, max, name] of fields) {
    if (typeof value !== "string" || value.length === 0 || value.length > max) {
      throw new Error(`${name} is missing or too long`);
    }
  }
}

const dusdc = (amount: bigint) => (Number(amount) / 1e6).toString();

const judgeView = (
  proposal: Proposal,
  amount: bigint,
  vendors: { name: string; address: string }[]
) => ({
  vendor: vendors.find((v) => v.address === proposal.recipient)?.name ?? "unknown",
  recipient: proposal.recipient,
  amountDusdc: dusdc(amount),
  memo: proposal.memo,
  reasoning: proposal.reasoning,
});

export async function cosign(body: unknown, deps: Deps): Promise<CosignResult> {
  const vault = deps.ctx.vault.toBase58();
  const { memo, recipient, amount, reasoning } = ((body as CosignRequest)?.proposal ??
    {}) as Partial<Proposal>;
  const userTask = (body as CosignRequest)?.userTask;
  const base = {
    ts: new Date().toISOString(),
    vault,
    userTask,
    recipient,
    amount,
    memo,
    reasoning,
  };

  let stage: Decision["stage"] = "request";
  let verdict: Verdict | undefined;
  const deny = (reason: string, status: 400 | 403 | 500): CosignResult => {
    const rationale = verdict?.rationale ?? reason;
    const risk = verdict?.risk;
    try {
      deps.record({ ...base, decision: "deny", stage, reason, risk, rationale });
    } catch {
      return { status: 500, verdict: "deny", stage, rationale: "could not log the decision" };
    }
    return { status, verdict: "deny", stage, rationale, risk };
  };

  try {
    checkShape(body);
    stage = "decode";
    const tx = decodeAndVerify(body.serializedTx, body.proposal, deps.ctx);
    const payee = body.proposal.recipient;

    stage = "rules";
    const value = parseAmount(body.proposal.amount);
    const state = await deps.chainState(new PublicKey(payee), value);
    const violation = ruleViolation(state);
    if (violation) return deny(violation, 403);
    if (
      isDuplicate(deps.history(), { ...body.proposal, vault, userTask: body.userTask }, Date.now())
    ) {
      return deny("duplicate of a payment approved in the last 24 hours", 403);
    }

    stage = "judge";
    const vendors = await deps.vendors();
    verdict = await deps.judge({
      userTask: body.userTask,
      proposal: judgeView(body.proposal, value, vendors),
      vendors,
    });
    if (verdict.verdict !== "approve") return deny("judge denied", 403);

    stage = "sign";
    tx.partialSign(deps.guardKey);
    deps.record({
      ...base,
      decision: "approve",
      stage,
      risk: verdict.risk,
      rationale: verdict.rationale,
    });
    return {
      status: 200,
      signedTx: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      verdict: "approve",
      risk: verdict.risk,
      rationale: verdict.rationale,
    };
  } catch (err) {
    verdict = undefined;
    return deny(String((err as Error)?.message ?? err), stage === "judge" ? 500 : 403);
  }
}
