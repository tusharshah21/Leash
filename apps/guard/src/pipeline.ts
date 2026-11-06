// The guard pipeline, in order: decode, rules, judge, sign. Any error refuses without a signature.
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
      proposal: {
        vendor: vendors.find((v) => v.address === payee)?.name ?? "unknown",
        recipient: payee,
        amountDusdc: dusdc(value),
        memo: body.proposal.memo,
        reasoning: body.proposal.reasoning,
      },
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
