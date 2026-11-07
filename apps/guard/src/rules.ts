// Step two: deterministic checks against chain state and the guard's own log.
import type { Tier } from "@leash/sdk";

export interface ChainState {
  paused: boolean;
  expired: boolean;
  allowlisted: boolean;
  tier: Tier;
}

/** One line of logs/guard.jsonl. */
export interface Decision {
  ts: string;
  vault: string;
  userTask?: string;
  recipient?: string;
  amount?: string;
  memo?: string;
  reasoning?: string;
  decision: "approve" | "deny";
  stage: "request" | "decode" | "rules" | "judge" | "sign";
  reason?: string;
  risk?: number;
  rationale?: string;
}

const DAY_MS = 86_400_000;
const normalize = (memo: string) => memo.toLowerCase().replace(/\s+/g, " ").trim();

/** Lines of guard.jsonl split by whether they belong to a vault. Unreadable lines are kept. */
export function splitByVault(lines: string[], vault: string) {
  const keep: string[] = [];
  const removed: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    let ours = false;
    try {
      ours = JSON.parse(line).vault === vault;
    } catch {
      // Not ours to judge.
    }
    (ours ? removed : keep).push(line);
  }
  return { keep, removed };
}

/** The reason to refuse, or null. */
export function ruleViolation(state: ChainState): string | null {
  if (state.paused) return "vault is paused";
  if (state.expired) return "mandate has expired";
  if (!state.allowlisted) return "recipient is not on the allowlist";
  if (state.tier === "HIGH") return "amount is over the mandate's limits and needs human approval";
  return null;
}

/**
 * True if this vault already approved the same payment in the last 24 hours: same recipient and
 * amount, with the same memo or under the same task. The task clause stops a fooled executor from
 * paying an approved amount twice under a new memo, which the judge cannot see, so a task that
 * really wants two identical payments gets its second one refused. Scoped per vault so a fresh demo
 * vault starts clean. An approval whose transaction never landed still counts, so the failure mode
 * is a refused retry rather than a double payment.
 */
export function isDuplicate(
  history: Decision[],
  p: { vault: string; recipient: string; amount: string; memo: string; userTask: string },
  nowMs: number
) {
  return history.some(
    (d) =>
      d.decision === "approve" &&
      d.vault === p.vault &&
      d.recipient === p.recipient &&
      d.amount === p.amount &&
      (normalize(d.memo ?? "") === normalize(p.memo) || d.userTask === p.userTask) &&
      nowMs - Date.parse(d.ts) < DAY_MS
  );
}
