import { Buffer } from "buffer";
import type { AnchorProvider, Program as AnchorProgram } from "@anchor-lang/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from "@solana/web3.js";
import { BN, Program, utils } from "./anchor.js";
import { errorName, LeashTxError } from "./errors.js";
import { type LeashEvent, parseEvents } from "./events.js";
import { IDL, type Leash } from "./idl.js";
import { classifyTier, patchClearDevice, type Tier } from "./tier.js";

export const PROGRAM_ID = new PublicKey((IDL as unknown as { address: string }).address);

const seedPda = (...seeds: (string | Buffer | PublicKey)[]) =>
  PublicKey.findProgramAddressSync(
    seeds.map((s) =>
      typeof s === "string" ? Buffer.from(s) : Buffer.isBuffer(s) ? s : s.toBuffer()
    ),
    PROGRAM_ID
  )[0];

export const vaultPda = (owner: PublicKey) => seedPda("vault", owner);
export const vaultTokenPda = (vault: PublicKey) => seedPda("vault_token", vault);
export const mandatePda = (vault: PublicKey) => seedPda("mandate", vault);
export const allowPda = (vault: PublicKey, recipient: PublicKey) =>
  seedPda("allow", vault, recipient);
export const pendingPda = (vault: PublicKey, nonce: bigint) =>
  seedPda("pending", vault, new BN(nonce.toString()).toArrayLike(Buffer, "le", 8));

/** sha256 of the reason text, as the 32 bytes the program stores. */
export const reasonHash = (text: string): number[] =>
  Array.from(Buffer.from(utils.sha256.hash(text), "hex"));

const big = (x: BN) => BigInt(x.toString());
const bn = (x: bigint) => new BN(x.toString());

/** Anything that can co-sign: a wallet in this process, or a remote guard service. */
export interface TxSigner {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
}

export interface ExecuteParams {
  amount: bigint;
  recipient: PublicKey;
  reason: string;
  /** Needed for MEDIUM. */
  guard?: TxSigner;
  /** Defaults to the recipient's associated token account. */
  recipientTokenAccount?: PublicKey;
  /** Lets a failing transaction land onchain, so it has a signature to link to. */
  skipPreflight?: boolean;
}

/** One signature that mentions a vault. */
export interface HistoryItem {
  signature: string;
  blockTime: number | null;
  failed: boolean;
  events: LeashEvent[];
  /** Set when this is a failed agent_execute: what it tried, and why the program refused. */
  attempt?: { amount: string; recipientTokenAccount: string; error?: string };
}

const EXECUTE_DISCRIMINATOR = Buffer.from(
  (
    IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }
  ).instructions.find((ix) => ix.name === "agent_execute")!.discriminator
);
const RECIPIENT_TOKEN_INDEX = 6;

export type ActResult =
  | { tier: "LOW" | "MEDIUM"; signature: string }
  | { tier: "HIGH"; signature: string; nonce: bigint };

/**
 * A client for one vault, signing as `provider.wallet`. Make one per identity: the agent's wallet
 * for execute, propose and act, the owner's or device's for approve, reject and revoke.
 */
export class LeashClient {
  readonly program: AnchorProgram<Leash>;
  readonly vault: PublicKey;
  readonly mandate: PublicKey;
  readonly vaultToken: PublicKey;

  constructor(readonly provider: AnchorProvider, readonly owner: PublicKey) {
    this.program = new Program<Leash>(IDL, provider);
    this.vault = vaultPda(owner);
    this.mandate = mandatePda(this.vault);
    this.vaultToken = vaultTokenPda(this.vault);
  }

  /** A client for a vault by address, when you do not know its owner. */
  static async forVault(provider: AnchorProvider, vault: PublicKey) {
    const { owner } = await new Program<Leash>(IDL, provider).account.vault.fetch(vault);
    return new LeashClient(provider, owner);
  }

  private get signer() {
    return this.provider.wallet.publicKey;
  }

  private get connection() {
    return this.provider.connection;
  }

  fetchVault = () => this.program.account.vault.fetch(this.vault);
  fetchMandate = () => this.program.account.mandate.fetch(this.mandate);

  /** Every proposal that still has an account, with its nonce, which the account does not store. */
  async fetchPending() {
    const { pendingBase, pendingNonce } = await this.fetchVault();
    const base = big(pendingBase);
    const count = Number(big(pendingNonce) - base);
    const nonces = Array.from({ length: count }, (_, i) => base + BigInt(i));
    const addresses = nonces.map((n) => pendingPda(this.vault, n));
    const accounts = await this.program.account.pendingAction.fetchMultiple(addresses);
    return accounts.flatMap((account, i) =>
      account ? [{ ...account, nonce: nonces[i], address: addresses[i] }] : []
    );
  }

  /** This vault's allowlist. Entries store no vault, so this keeps those whose PDA is ours. */
  async fetchAllowlist() {
    const all = await this.program.account.allowEntry.all();
    return all.flatMap(({ publicKey, account }) =>
      allowPda(this.vault, account.recipient).equals(publicKey)
        ? [
            {
              address: publicKey,
              recipient: account.recipient,
              label: Buffer.from(account.label).toString("utf8").replace(/\0+$/, ""),
              perRecipientCap: big(account.perRecipientCap),
            },
          ]
        : []
    );
  }

  /** Pays an allowlisted recipient. Use `act` unless you already know the tier. */
  async execute(p: ExecuteParams): Promise<string> {
    const { mint } = await this.fetchVault();
    const tx = await this.program.methods
      .agentExecute(bn(p.amount), reasonHash(p.reason))
      .accountsPartial({
        agent: this.signer,
        guard: p.guard?.publicKey ?? null,
        vault: this.vault,
        mandate: this.mandate,
        mint,
        vaultTokenAccount: this.vaultToken,
        recipientTokenAccount:
          p.recipientTokenAccount ?? getAssociatedTokenAddressSync(mint, p.recipient),
        allowEntry: allowPda(this.vault, p.recipient),
      })
      .transaction();
    return this.send(tx, { guard: p.guard, skipPreflight: p.skipPreflight });
  }

  /** Asks a human to approve a payment. Moves no funds. */
  async propose(amount: bigint, recipient: PublicKey, reason: string) {
    const nonce = big((await this.fetchVault()).pendingNonce);
    const tx = await this.program.methods
      .agentPropose(bn(amount), recipient, reasonHash(reason))
      .accountsPartial({
        agent: this.signer,
        vault: this.vault,
        mandate: this.mandate,
        pendingAction: pendingPda(this.vault, nonce),
      })
      .transaction();
    return { signature: await this.send(tx), nonce };
  }

  /** Executes or proposes, whichever the mandate calls for right now. */
  async act(
    amount: bigint,
    recipient: PublicKey,
    reason: string,
    opts: { guard?: TxSigner } = {}
  ): Promise<ActResult> {
    const tier = await this.classify(amount, recipient);
    if (tier === "HIGH") {
      return { tier, ...(await this.propose(amount, recipient, reason)) };
    }
    if (tier === "MEDIUM" && !opts.guard) {
      throw new Error(`A payment of ${amount} is MEDIUM risk and needs the guard's co-signature`);
    }
    const guard = tier === "MEDIUM" ? opts.guard : undefined;
    return { tier, signature: await this.execute({ amount, recipient, reason, guard }) };
  }

  /** The tier a payment gets right now. Pause and expiry are not tiers: those fail onchain. */
  async classify(amount: bigint, recipient: PublicKey): Promise<Tier> {
    const [m, entry, clock] = await Promise.all([
      this.fetchMandate(),
      this.program.account.allowEntry.fetchNullable(allowPda(this.vault, recipient)),
      this.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"),
    ]);
    if (!clock) throw new Error("Could not read the cluster clock");
    return classifyTier(
      {
        lowThreshold: big(m.lowThreshold),
        perTxMax: big(m.perTxMax),
        dailyCap: big(m.dailyCap),
        windowStart: big(m.windowStart),
        windowSecs: big(m.windowSecs),
      },
      entry ? { perRecipientCap: big(entry.perRecipientCap) } : null,
      big(m.spentToday),
      amount,
      Buffer.from(clock.data).readBigInt64LE(32)
    );
  }

  /**
   * Unsigned approval, by a key that need not be this client's wallet. Creates the recipient's
   * token account if it is missing, since a proposal can name any wallet.
   */
  approveTx(
    nonce: bigint,
    authority: PublicKey,
    { mint, recipient }: { mint: PublicKey; recipient: PublicKey }
  ): Promise<Transaction> {
    const recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient);
    return this.program.methods
      .approvePending(bn(nonce))
      .accountsPartial({
        authority,
        vault: this.vault,
        mandate: this.mandate,
        pendingAction: pendingPda(this.vault, nonce),
        mint,
        vaultTokenAccount: this.vaultToken,
        recipientTokenAccount,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          authority,
          recipientTokenAccount,
          recipient,
          mint
        ),
      ])
      .transaction();
  }

  rejectTx(nonce: bigint, authority: PublicKey): Promise<Transaction> {
    return this.program.methods
      .rejectPending(bn(nonce))
      .accountsPartial({
        authority,
        vault: this.vault,
        pendingAction: pendingPda(this.vault, nonce),
      })
      .transaction();
  }

  revokeTx(authority: PublicKey): Promise<Transaction> {
    return this.program.methods
      .revokeAgent()
      .accountsPartial({ authority, vault: this.vault })
      .transaction();
  }

  async approve(nonce: bigint): Promise<string> {
    const [{ mint }, { recipient }] = await Promise.all([
      this.fetchVault(),
      this.program.account.pendingAction.fetch(pendingPda(this.vault, nonce)),
    ]);
    return this.send(await this.approveTx(nonce, this.signer, { mint, recipient }));
  }

  async reject(nonce: bigint): Promise<string> {
    return this.send(await this.rejectTx(nonce, this.signer));
  }

  /** Owner only. Returns a settled proposal's rent to the owner. */
  async close(nonce: bigint): Promise<string> {
    const tx = await this.program.methods
      .closePending(bn(nonce))
      .accountsPartial({
        owner: this.signer,
        vault: this.vault,
        pendingAction: pendingPda(this.vault, nonce),
      })
      .transaction();
    return this.send(tx);
  }

  async revoke(): Promise<string> {
    return this.send(await this.revokeTx(this.signer));
  }

  /**
   * Owner only, on a paused vault. Returns every token and all rent to the owner, and closes every
   * allow entry, so a vault recreated here starts with an empty allowlist. Pending actions stay
   * behind inert, and `close` reclaims their rent once a new vault exists.
   */
  async closeVault(): Promise<string> {
    const [{ mint }, allowlist] = await Promise.all([this.fetchVault(), this.fetchAllowlist()]);
    const ownerTokenAccount = getAssociatedTokenAddressSync(mint, this.owner);
    const tx = await this.program.methods
      .closeVault()
      .accountsPartial({
        owner: this.owner,
        vault: this.vault,
        mandate: this.mandate,
        mint,
        ownerTokenAccount,
        vaultTokenAccount: this.vaultToken,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          this.owner,
          ownerTokenAccount,
          this.owner,
          mint
        ),
      ])
      .remainingAccounts(
        allowlist.map(({ address }) => ({ pubkey: address, isSigner: false, isWritable: true }))
      )
      .transaction();
    return this.send(tx);
  }

  async unpause(): Promise<string> {
    const tx = await this.program.methods
      .unpause()
      .accountsPartial({ owner: this.signer, vault: this.vault })
      .transaction();
    return this.send(tx);
  }

  /** Owner only. An omitted key stays as it is, and `device: null` removes the device key. */
  async rotateKeys(keys: {
    agent?: PublicKey;
    guard?: PublicKey;
    device?: PublicKey | null;
  }): Promise<string> {
    const ix = await this.program.methods
      .rotateKeys(keys.agent ?? null, keys.guard ?? null, keys.device ?? null)
      .accountsPartial({ owner: this.signer, vault: this.vault })
      .instruction();
    return this.send(new Transaction().add(keys.device === null ? patchClearDevice(ix) : ix));
  }

  /** Calls back on each of this vault's events as they confirm. Returns an unsubscribe function. */
  onLeashEvent(callback: (event: LeashEvent) => void): () => void {
    const id = this.connection.onLogs(
      PROGRAM_ID,
      ({ err, logs, signature }) => {
        if (err) return;
        parseEvents(this.program, logs, signature)
          .filter((e) => this.isOurs(e))
          .forEach(callback);
      },
      "confirmed"
    );
    return () => void this.connection.removeOnLogsListener(id);
  }

  /** This vault's newest events first, for page load. */
  async fetchRecentEvents(limit: number): Promise<LeashEvent[]> {
    const signatures = await this.connection.getSignaturesForAddress(
      this.vault,
      { limit },
      "confirmed"
    );
    // One at a time: the public devnet RPC rejects a whole getTransactions batch with a 429,
    // while single calls retry with backoff.
    const events: LeashEvent[] = [];
    for (const { signature, err } of signatures) {
      if (err) continue;
      const tx = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const parsed = parseEvents(this.program, tx?.meta?.logMessages ?? [], signature);
      events.push(...parsed.filter((e) => this.isOurs(e)));
    }
    return events.slice(0, limit);
  }

  /**
   * Every recent transaction on this vault, newest first, including failed ones, which carry no
   * events. Pass the same cache to later calls so they only fetch what is new. If the RPC refuses a
   * transaction, for example when rate limited, the rest come from the cache only, so the result is
   * partial rather than an error, and a later call fills the gap.
   */
  async fetchHistory(limit: number, cache = new Map<string, HistoryItem>()) {
    const signatures = await this.connection.getSignaturesForAddress(
      this.vault,
      { limit },
      "confirmed"
    );
    const items: HistoryItem[] = [];
    let refused = false;
    for (const { signature, err, blockTime } of signatures) {
      let item = cache.get(signature);
      if (!item) {
        if (refused) continue;
        const tx = await this.connection
          .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
          .catch(() => {
            refused = true;
            return null;
          });
        if (!tx) continue; // Not indexed yet. The next refresh picks it up.
        const logs = tx.meta?.logMessages ?? [];
        item = {
          signature,
          blockTime: blockTime ?? null,
          failed: err !== null,
          events: parseEvents(this.program, logs, signature).filter((e) => this.isOurs(e)),
        };
        if (err !== null) {
          const message = tx.transaction.message;
          for (const ix of message.compiledInstructions) {
            const data = Buffer.from(ix.data);
            const isExecute =
              message.staticAccountKeys[ix.programIdIndex].equals(PROGRAM_ID) &&
              data.subarray(0, 8).equals(EXECUTE_DISCRIMINATOR);
            if (!isExecute) continue;
            item.attempt = {
              amount: data.readBigUInt64LE(8).toString(),
              recipientTokenAccount:
                message.staticAccountKeys[ix.accountKeyIndexes[RECIPIENT_TOKEN_INDEX]].toBase58(),
              error: errorName({ logs, message: JSON.stringify(err) }),
            };
          }
        }
        cache.set(signature, item);
      }
      items.push(item);
    }
    return items;
  }

  /** Signs as this client's wallet, sends and confirms a transaction built elsewhere. */
  sendTx = (tx: Transaction) => this.send(tx);

  private isOurs(event: LeashEvent) {
    return event.data.vault.equals(this.vault);
  }

  /** Signs (guard first), sends and confirms. Failures become LeashTxError. */
  private async send(
    tx: Transaction,
    opts: { guard?: TxSigner; skipPreflight?: boolean } = {}
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(
      "confirmed"
    );
    tx.feePayer = this.signer;
    tx.recentBlockhash = blockhash;

    let signature: string | undefined;
    try {
      const guarded = opts.guard ? await opts.guard.signTransaction(tx) : tx;
      const signed = await this.provider.wallet.signTransaction(guarded);
      signature = await this.connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: opts.skipPreflight,
        preflightCommitment: "confirmed",
      });
      const { value } = await this.connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      if (value.err) throw new Error(JSON.stringify(value.err));
      return signature;
    } catch (err) {
      const logs = signature
        ? (
            await this.connection.getTransaction(signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            })
          )?.meta?.logMessages ?? undefined
        : (err as { logs?: string[] }).logs;
      throw new LeashTxError(err, signature, logs);
    }
  }
}
