import type { LeashEvent } from "./events.js";
import { reasonHash } from "./client.js";

/** One line of logs/activity.jsonl. Only `ts`, `actor` and `kind` are always set. */
export interface ActivityEntry {
  ts: string;
  actor: "agent" | "guard" | "demo";
  kind: string;
  runId?: string;
  /** The vault this entry belongs to. */
  vault?: string;
  /** The proposal's nonce, on HIGH payments and guard reviews. */
  nonce?: string;
  /** Deterministic rule findings, on guard reviews. */
  findings?: string[];
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

const PUBLIC_KINDS = new Set(["pay", "review", "probe"]);
const PUBLIC_FIELDS = [
  "ts",
  "actor",
  "kind",
  "vault",
  "nonce",
  "tier",
  "amount",
  "recipient",
  "memo",
  "reasoning",
  "reasonHash",
  "verdict",
  "risk",
  "rationale",
  "findings",
  "txSig",
  "error",
] as const;

/** Only what the dashboard may show: known kinds, for one vault if given, and whitelisted fields. */
export function sanitizeActivity(entries: ActivityEntry[], vault?: string): ActivityEntry[] {
  return entries
    .filter((e) => PUBLIC_KINDS.has(e.kind) && e.vault && (!vault || e.vault === vault))
    .map((e) => {
      const clean: Record<string, unknown> = {};
      for (const key of PUBLIC_FIELDS) if (e[key] !== undefined) clean[key] = e[key];
      return clean as unknown as ActivityEntry;
    });
}
