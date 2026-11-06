import type { LeashEvent } from "./events.js";
import { reasonHash } from "./client.js";

/** One line of logs/activity.jsonl. Only `ts`, `actor` and `kind` are always set. */
export interface ActivityEntry {
  ts: string;
  actor: "agent" | "guard" | "demo";
  kind: string;
  runId?: string;
  tier?: string;
  /** Base units, as a string. */
  amount?: string;
  recipient?: string;
  memo?: string;
  reasoning?: string;
  reasonHash?: string;
  verdict?: "approve" | "deny";
  risk?: number;
  rationale?: string;
  txSig?: string;
  error?: string;
  /** OpenAI token counts, on `usage` entries. */
  inputTokens?: number;
  outputTokens?: number;
}

/** True when the entry's reasoning text is what the onchain event committed to. */
export function verifyReasoning(entry: Pick<ActivityEntry, "reasoning">, event: LeashEvent) {
  if (event.name !== "actionExecuted" && event.name !== "actionPending") return false;
  if (entry.reasoning === undefined) return false;
  const expected = reasonHash(entry.reasoning);
  const actual = Array.from(event.data.reasonHash);
  return actual.length === expected.length && actual.every((b, i) => b === expected[i]);
}
