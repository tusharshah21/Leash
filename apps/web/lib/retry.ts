// Keeping the console usable when the RPC rate-limits it: each part of a refresh falls back to its
// last good value, and a failed refresh is retried sooner than the regular poll, backing off.

const BASE_MS = 1_000;
const MAX_MS = 30_000;

/** Delay before retry number `attempt` (0-based): doubling from 1s, capped at 30s, with jitter. */
export function backoffMs(attempt: number, random = Math.random) {
  const ceiling = Math.min(MAX_MS, BASE_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/**
 * A request's value, or the last good one if it failed. Throws when there is nothing to fall back
 * on, or when `fatal` says the failure must not be hidden, such as the vault no longer existing.
 */
export function settledOr<T>(
  result: PromiseSettledResult<T>,
  previous: T | undefined,
  fatal: (reason: unknown) => boolean = () => false
): T {
  if (result.status === "fulfilled") return result.value;
  if (previous === undefined || fatal(result.reason)) throw result.reason;
  return previous;
}
