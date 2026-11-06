/** Short messages for every program error, in code order from 6000. */
const MESSAGES = {
  Unauthorized: "Signer is not allowed to do this",
  VaultPaused: "Vault is paused",
  VaultNotPaused: "Pause the vault first",
  MandateExpired: "Mandate has expired",
  InvalidMandate: "Mandate values are invalid",
  NotAllowlisted: "Recipient not on the allowlist",
  ExceedsDailyCap: "Over the daily cap, needs approval",
  GuardSignatureRequired: "Guard co-signature required",
  InvalidAmount: "Amount must be above zero",
  KeyReuseNotAllowed: "Agent, guard and device keys must be different",
  RequiresApproval: "Over the per-transaction limit, needs approval",
  PendingExpired: "Proposal has expired",
  PendingNotActive: "Proposal is already settled",
  RecipientMismatch: "Token account does not match the recipient",
  MathOverflow: "Amount is too large",
  PendingStillActive: "Approve or reject the proposal first",
} as const;

export type LeashErrorName = keyof typeof MESSAGES;

const NAMES = Object.keys(MESSAGES) as LeashErrorName[];
const FIRST_CODE = 6000;

/** The program error name from an error's Anchor fields or transaction logs, if there is one. */
export function errorName(err: unknown): LeashErrorName | undefined {
  const e = err as { code?: string; error?: { errorCode?: { code?: string } }; logs?: string[] };
  const direct = e?.code ?? e?.error?.errorCode?.code;
  if (direct && direct in MESSAGES) return direct as LeashErrorName;

  const text = [...(e?.logs ?? []), String((err as Error)?.message ?? err)].join("\n");
  const named = text.match(/Error Code: (\w+)/)?.[1];
  if (named && named in MESSAGES) return named as LeashErrorName;

  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i)?.[1];
  return hex ? NAMES[parseInt(hex, 16) - FIRST_CODE] : undefined;
}

/** A short message for people. Falls back to the error's own message for non-program errors. */
export function describeError(err: unknown): string {
  const name = errorName(err);
  return name ? MESSAGES[name] : String((err as Error)?.message ?? err);
}

/** A transaction that failed, keeping its signature when it reached the chain. */
export class LeashTxError extends Error {
  readonly code?: LeashErrorName;
  constructor(cause: unknown, readonly signature?: string, readonly logs?: string[]) {
    const details = { logs, message: String((cause as Error)?.message ?? cause) };
    super(describeError(details));
    this.name = "LeashTxError";
    this.code = errorName(details);
  }
}
