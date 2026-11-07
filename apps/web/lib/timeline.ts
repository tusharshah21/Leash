// Merges chain history with the activity log into timeline rows. The chain decides every outcome.
// Activity only explains why, or records what never reached the chain (a guard's refusal).
import { type ActivityEntry, type HistoryItem, verifyReasoning } from "@leash/sdk";

export type Outcome =
  | "PAID"
  | "PENDING"
  | "EXPIRED"
  | "REJECTED"
  | "BLOCKED BY CHAIN"
  | "BLOCKED BY GUARD"
  | "FAILED";

export type Verification = "verified" | "mismatch" | "none";

export interface Row {
  id: string;
  /** Unix seconds. */
  ts: number;
  outcome: Outcome;
  tier?: string;
  /** Base units. */
  amount: string;
  recipient?: string;
  /** Set when a recipient could not be worked out, which leaves only its token account. */
  recipientTokenAccount?: string;
  signature?: string;
  /** The approval or rejection of a proposal. */
  settledBy?: string;
  nonce?: string;
  /** True for what never reached the chain, so its only source is the guard's or agent's log. */
  offchain: boolean;
  error?: string;
  memo?: string;
  reasoning?: string;
  verification: Verification;
  guard?: { verdict?: string; risk?: number; rationale?: string };
  review?: { verdict?: string; risk?: number; rationale?: string; findings?: string[] };
}

export interface TimelineInput {
  history: HistoryItem[];
  activity: ActivityEntry[];
  /** Proposals that passed their expiry while still pending, by nonce. */
  expiredNonces?: Set<string>;
  /** Known token accounts, for naming the recipient of a failed transaction. */
  walletByTokenAccount?: Map<string, string>;
}

const tierName = (tier: unknown) => Object.keys(tier as object)[0]?.toUpperCase();
const toUnix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function buildTimeline(input: TimelineInput): Row[] {
  const { expiredNonces, walletByTokenAccount } = input;
  // A vault recreated at this address shares its transaction history with the closed one.
  const closed = input.history.findIndex((i) => i.events.some((e) => e.name === "vaultClosed"));
  const history = closed < 0 ? input.history : input.history.slice(0, closed);
  const closedAt = closed < 0 ? 0 : input.history[closed].blockTime ?? 0;
  const activity = input.activity.filter((e) => toUnix(e.ts) >= closedAt);
  const bySig = new Map<string, ActivityEntry>();
  const reviews = new Map<string, ActivityEntry>();
  for (const e of activity) {
    if (e.kind === "review" && e.nonce) reviews.set(e.nonce, e);
    else if (e.txSig) bySig.set(e.txSig, e);
  }

  const explained = (signature: string) => {
    const entry = bySig.get(signature);
    return {
      memo: entry?.memo,
      reasoning: entry?.reasoning,
      guard:
        entry?.verdict || entry?.rationale
          ? { verdict: entry.verdict, risk: entry.risk, rationale: entry.rationale }
          : undefined,
    };
  };

  const rows: Row[] = [];
  const proposals = new Map<string, Row>();

  // Oldest first, so a proposal's row exists by the time its approval or rejection is read.
  for (const item of [...history].reverse()) {
    const ts = item.blockTime ?? 0;
    for (const event of item.events) {
      if (event.name === "actionExecuted") {
        const why = explained(item.signature);
        rows.push({
          id: item.signature,
          ts,
          outcome: "PAID",
          tier: tierName(event.data.tier),
          amount: event.data.amount.toString(),
          recipient: event.data.recipient.toBase58(),
          signature: item.signature,
          offchain: false,
          ...why,
          verification: verification(why.reasoning, event),
        });
      } else if (event.name === "actionPending") {
        const nonce = event.data.nonce.toString();
        const why = explained(item.signature);
        const row: Row = {
          id: item.signature,
          ts,
          outcome: expiredNonces?.has(nonce) ? "EXPIRED" : "PENDING",
          tier: "HIGH",
          amount: event.data.amount.toString(),
          recipient: event.data.recipient.toBase58(),
          signature: item.signature,
          nonce,
          offchain: false,
          ...why,
          verification: verification(why.reasoning, event),
          review: reviews.get(nonce) && reviewOf(reviews.get(nonce)!),
        };
        rows.push(row);
        proposals.set(nonce, row);
      } else if (event.name === "actionApproved" || event.name === "actionRejected") {
        const row = proposals.get(event.data.nonce.toString());
        if (row) {
          row.outcome = event.name === "actionApproved" ? "PAID" : "REJECTED";
          row.settledBy = item.signature;
          row.ts = ts;
        }
      }
    }
    if (item.failed && item.attempt) {
      const why = explained(item.signature);
      const entry = bySig.get(item.signature);
      const recipient =
        entry?.recipient ?? walletByTokenAccount?.get(item.attempt.recipientTokenAccount);
      rows.push({
        id: item.signature,
        ts,
        outcome: "BLOCKED BY CHAIN",
        amount: item.attempt.amount,
        recipient,
        recipientTokenAccount: recipient ? undefined : item.attempt.recipientTokenAccount,
        signature: item.signature,
        offchain: false,
        error: item.attempt.error,
        ...why,
        // A failed transaction emits no event, so there is no onchain hash to compare against.
        verification: "none",
      });
    }
  }

  // What never landed. A pay entry with a signature is the chain's to report, above.
  for (const e of activity) {
    if (e.kind !== "pay" || e.txSig || !e.error) continue;
    const denied = e.verdict === "deny";
    rows.push({
      id: `offchain-${e.ts}-${e.recipient}-${e.amount}`,
      ts: toUnix(e.ts),
      outcome: denied ? "BLOCKED BY GUARD" : "FAILED",
      tier: e.tier,
      amount: e.amount ?? "0",
      recipient: e.recipient,
      offchain: true,
      error: e.error,
      memo: e.memo,
      reasoning: e.reasoning,
      verification: "none",
      guard: denied ? { verdict: e.verdict, risk: e.risk, rationale: e.rationale } : undefined,
    });
  }

  return rows.sort((a, b) => b.ts - a.ts);
}

const reviewOf = (e: ActivityEntry) => ({
  verdict: e.verdict,
  risk: e.risk,
  rationale: e.rationale,
  findings: e.findings,
});

function verification(
  reasoning: string | undefined,
  event: Parameters<typeof verifyReasoning>[1]
): Verification {
  if (reasoning === undefined) return "none";
  return verifyReasoning({ reasoning }, event) ? "verified" : "mismatch";
}

/** The agent's explanation and the guard's review of a proposal, for its pending card. */
export function proposalContext(activity: ActivityEntry[], nonce: string) {
  const pay = activity.find((e) => e.kind === "pay" && e.nonce === nonce);
  const review = activity.find((e) => e.kind === "review" && e.nonce === nonce);
  return {
    memo: pay?.memo,
    reasoning: pay?.reasoning,
    review: review && reviewOf(review),
  };
}
