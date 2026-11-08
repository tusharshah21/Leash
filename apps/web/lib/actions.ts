// Solana Actions: what a Blink shows and the unsigned transactions behind its buttons. Everything
// here takes loaded chain data, so it runs in tests without a network. `actions-chain.ts` does the
// loading. A transaction built here is only ever signed by the wallet that asked for it.
import { type ActivityEntry, type LeashClient, reasonHash } from "@leash/sdk";
import { PublicKey, type Transaction } from "@solana/web3.js";
import { proposalContext } from "./timeline.ts";

/** Devnet's CAIP-2 ID, from the Actions spec's BLOCKCHAIN_IDS. */
const DEVNET_ID = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** The headers from `ACTIONS_CORS_HEADERS` in @solana/actions 1.6.6, plus the version and chain. */
export const ACTION_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "Content-Type": "application/json",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": DEVNET_ID,
};

export const ACTIONS_JSON = {
  rules: [{ pathPattern: "/api/actions/**", apiPath: "/api/actions/**" }],
};

export interface LoadedVault {
  owner: PublicKey;
  device: PublicKey | null;
  mint: PublicKey;
  paused: boolean;
  pendingBase: bigint;
}

export interface LoadedPending {
  recipient: PublicKey;
  /** Base units. */
  amount: bigint;
  status: "pending" | "approved" | "rejected" | "executed";
  createdAt: number;
  ttlSecs: number;
  /** The cluster's clock, in unix seconds. */
  chainNow: number;
  /** The allowlist's name for the recipient, or a known vendor's. */
  label?: string;
  listed: boolean;
  reasonHash: number[];
  activity: ActivityEntry[];
}

export interface ActionDeps {
  /** Origin of the public site, with no trailing slash. */
  site: string;
  loadVault(vault: PublicKey): Promise<LoadedVault | null>;
  loadPending(vault: PublicKey, nonce: bigint, loaded: LoadedVault): Promise<LoadedPending | null>;
  clientFor(owner: PublicKey): Pick<LeashClient, "approveTx" | "rejectTx" | "revokeTx">;
  blockhash(): Promise<string>;
}

export interface ActionResult {
  status: number;
  body: object;
}

const U64_MAX = (1n << 64n) - 1n;
const REASONING_MAX = 280;
const RATIONALE_MAX = 240;

const failure = (status: number, message: string): ActionResult => ({
  status,
  body: { message },
});

const dusdc = (base: bigint) =>
  (Number(base) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;

const parseKey = (value: unknown) => {
  try {
    return typeof value === "string" ? new PublicKey(value) : null;
  } catch {
    return null;
  }
};

const parseNonce = (value: string) => {
  if (!/^\d{1,20}$/.test(value)) return null;
  const nonce = BigInt(value);
  return nonce <= U64_MAX ? nonce : null;
};

export const pendingPath = (vault: string, nonce: string) =>
  `/api/actions/pending/${vault}/${nonce}`;
export const revokePath = (vault: string) => `/api/actions/revoke/${vault}`;

/** Dialect's Blink page. Its deployment was paused when this was built, so it is the second choice. */
export const dialUrl = (actionUrl: string) =>
  `https://dial.to/?action=${encodeURIComponent(`solana-action:${actionUrl}`)}&cluster=devnet`;

/** Our own Blink page for an action. */
export const blinkPage = (site: string, path: string) =>
  `${site}/blink?action=${encodeURIComponent(path)}`;

/** Opens our Blink page inside Phantom's in-app browser, where the wallet is already there. */
export const phantomUrl = (site: string, path: string) =>
  `https://phantom.com/ul/browse/${encodeURIComponent(
    blinkPage(site, path)
  )}?ref=${encodeURIComponent(site)}`;

/** Why a proposal can no longer be decided here, or null while it is open. */
export function closedReason(p: LoadedPending) {
  if (p.status === "executed" || p.status === "approved") return "Already approved and paid.";
  if (p.status === "rejected") return "Already rejected. No funds moved.";
  if (p.chainNow > p.createdAt + p.ttlSecs) return "Expired. It can no longer move funds.";
  return null;
}

const STALE = "This proposal belongs to a vault that was closed. It can never move funds.";
const NO_VAULT = "There is no Leash vault at this address on devnet.";
const NO_PROPOSAL = "There is no proposal with this nonce. It may have been closed.";

function disabled(icon: string, title: string, reason: string): ActionResult {
  return {
    status: 200,
    body: {
      type: "action",
      icon,
      title,
      description: reason,
      label: "Nothing to decide",
      disabled: true,
      error: { message: reason },
    },
  };
}

/**
 * The human-readable case. Only the amount, recipient and allowlist status decide the title, and
 * they come from the chain. Reasoning is influenced by whatever the agent read, so it appears only
 * if it matches the onchain hash, and it is labelled as a claim.
 */
function describe(p: LoadedPending, nonce: string) {
  const name = p.label ?? "Unlisted address";
  const recipient = p.recipient.toBase58();
  const { reasoning, review } = proposalContext(p.activity, nonce);
  const verified =
    reasoning !== undefined && reasonHash(reasoning).every((b, i) => b === p.reasonHash[i]);
  const parts = [
    `${p.listed ? "On your allowlist" : "NOT ON ALLOWLIST"}. Recipient ${recipient}.`,
    verified
      ? `Agent claims: ${clip(reasoning, REASONING_MAX)}`
      : "No verified reasoning on record for this proposal.",
  ];
  if (review) {
    parts.push(
      `Guard review, advisory, risk ${review.risk ?? "n/a"}/100: ${clip(
        review.rationale ?? "no rationale given",
        RATIONALE_MAX
      )}`
    );
  }
  return {
    title: `${p.listed ? "" : "NOT ON ALLOWLIST: "}Pay ${dusdc(p.amount)} dUSDC to ${name}?`,
    description: parts.join("\n\n"),
  };
}

export async function getPending(
  vaultParam: string,
  nonceParam: string,
  deps: ActionDeps
): Promise<ActionResult> {
  const vault = parseKey(vaultParam);
  const nonce = parseNonce(nonceParam);
  if (!vault || nonce === null) return failure(400, "That is not a valid vault or nonce.");

  const path = `${deps.site}${pendingPath(vaultParam, nonceParam)}`;
  const icon = `${path}/card.png`;
  const title = "Leash pending payment";
  const loaded = await deps.loadVault(vault);
  if (!loaded) return disabled(icon, title, NO_VAULT);
  if (nonce < loaded.pendingBase) return disabled(icon, title, STALE);
  const pending = await deps.loadPending(vault, nonce, loaded);
  if (!pending) return disabled(icon, title, NO_PROPOSAL);

  const text = describe(pending, nonceParam);
  const reason = closedReason(pending);
  if (reason) return disabled(icon, text.title, `${reason}\n\n${text.description}`);
  return {
    status: 200,
    body: {
      type: "action",
      icon,
      ...text,
      label: "Decide",
      links: {
        actions: [
          { type: "transaction", label: "Approve", href: `${path}/approve` },
          { type: "transaction", label: "Reject", href: `${path}/reject` },
        ],
      },
    },
  };
}

async function asPostResponse(
  tx: Transaction,
  account: PublicKey,
  deps: ActionDeps,
  message: string
): Promise<ActionResult> {
  tx.feePayer = account;
  tx.recentBlockhash = await deps.blockhash();
  return {
    status: 200,
    body: {
      type: "transaction",
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      message,
    },
  };
}

export async function postDecision(
  decision: "approve" | "reject",
  vaultParam: string,
  nonceParam: string,
  requestBody: unknown,
  deps: ActionDeps
): Promise<ActionResult> {
  const vault = parseKey(vaultParam);
  const nonce = parseNonce(nonceParam);
  if (!vault || nonce === null) return failure(400, "That is not a valid vault or nonce.");
  const account = parseKey((requestBody as { account?: unknown } | null)?.account);
  if (!account) return failure(400, "The request needs a valid account.");

  const loaded = await deps.loadVault(vault);
  if (!loaded) return failure(404, NO_VAULT);
  const allowed = account.equals(loaded.owner) || !!loaded.device?.equals(account);
  if (!allowed) return failure(403, "Only this vault's owner or device key can decide this.");
  if (nonce < loaded.pendingBase) return failure(409, STALE);
  const pending = await deps.loadPending(vault, nonce, loaded);
  if (!pending) return failure(404, NO_PROPOSAL);
  const reason = closedReason(pending);
  if (reason) return failure(409, reason);

  const client = deps.clientFor(loaded.owner);
  const amount = `${dusdc(pending.amount)} dUSDC`;
  return decision === "approve"
    ? asPostResponse(
        await client.approveTx(nonce, account, {
          mint: loaded.mint,
          recipient: pending.recipient,
        }),
        account,
        deps,
        `Approved. Paying ${amount} to ${pending.label ?? short(pending.recipient.toBase58())}.`
      )
    : asPostResponse(
        await client.rejectTx(nonce, account),
        account,
        deps,
        `Rejected. The ${amount} stays in the vault.`
      );
}

export async function getRevoke(vaultParam: string, deps: ActionDeps): Promise<ActionResult> {
  const vault = parseKey(vaultParam);
  if (!vault) return failure(400, "That is not a valid vault.");
  const path = `${deps.site}${revokePath(vaultParam)}`;
  const icon = `${path}/card.png`;
  const title = "Revoke the agent";
  const loaded = await deps.loadVault(vault);
  if (!loaded) return disabled(icon, title, NO_VAULT);
  if (loaded.paused) return disabled(icon, title, "The agent is already revoked.");
  return {
    status: 200,
    body: {
      type: "action",
      icon,
      title,
      description: `Stops the agent on vault ${short(
        vaultParam
      )} immediately, onchain. Pending approvals keep working, and only the owner can unpause.`,
      label: "Revoke agent",
    },
  };
}

export async function postRevoke(
  vaultParam: string,
  requestBody: unknown,
  deps: ActionDeps
): Promise<ActionResult> {
  const vault = parseKey(vaultParam);
  if (!vault) return failure(400, "That is not a valid vault.");
  const account = parseKey((requestBody as { account?: unknown } | null)?.account);
  if (!account) return failure(400, "The request needs a valid account.");
  const loaded = await deps.loadVault(vault);
  if (!loaded) return failure(404, NO_VAULT);
  if (!account.equals(loaded.owner)) return failure(403, "Only the vault's owner can use this.");
  if (loaded.paused) return failure(409, "The agent is already revoked.");
  return asPostResponse(
    await deps.clientFor(loaded.owner).revokeTx(account),
    account,
    deps,
    "Agent revoked. It cannot pay or propose."
  );
}
