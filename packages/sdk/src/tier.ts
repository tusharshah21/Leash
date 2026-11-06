export type Tier = "LOW" | "MEDIUM" | "HIGH";

export interface MandateLimits {
  lowThreshold: bigint;
  perTxMax: bigint;
  dailyCap: bigint;
  windowStart: bigint;
  windowSecs: bigint;
}

export interface AllowLimits {
  perRecipientCap: bigint;
}

/**
 * Mirrors `Mandate::route` and `Mandate::roll_window` in programs/leash/src/state.rs. Change
 * both together.
 *
 * LOW and MEDIUM can use agent_execute (MEDIUM needs the guard). HIGH must use agent_propose.
 * Pause and mandate expiry are not tiers, so check those separately. An amount of zero is
 * InvalidAmount onchain rather than a tier, so it throws here.
 *
 * @param allowEntry the recipient's allow entry, or null if it has none
 * @param now unix seconds, ideally from the cluster's clock
 */
export function classifyTier(
  mandate: MandateLimits,
  allowEntry: AllowLimits | null,
  spentToday: bigint,
  amount: bigint,
  now: bigint
): Tier {
  if (amount <= 0n) throw new RangeError("amount must be greater than zero");
  if (allowEntry === null) return "HIGH";
  if (amount > mandate.perTxMax || amount > allowEntry.perRecipientCap) return "HIGH";

  const windowEnded = now >= mandate.windowStart + mandate.windowSecs;
  const spent = windowEnded ? 0n : spentToday;
  if (spent + amount > mandate.dailyCap) return "HIGH";

  return amount <= mandate.lowThreshold ? "LOW" : "MEDIUM";
}

/**
 * Makes a `rotate_keys` instruction remove the device key, meaning `new_device: Some(None)`.
 *
 * Anchor's TS coder encodes null as the outer None, so it cannot express Some(None). Build the
 * instruction with `rotateKeys(agent, guard, null)` and pass it here: `new_device` is the last
 * argument, so its None byte (0x00) is the last byte of the data, and this replaces it with
 * Some(None) (0x01 0x00). See Decision 11 in CLAUDE.md.
 */
export function patchClearDevice<T extends { data: Buffer }>(ix: T): T {
  if (ix.data.length === 0 || ix.data[ix.data.length - 1] !== 0) {
    throw new Error("expected a rotate_keys instruction built with new_device = null");
  }
  ix.data = Buffer.concat([ix.data.subarray(0, ix.data.length - 1), Buffer.from([1, 0])]);
  return ix;
}
