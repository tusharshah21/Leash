import * as anchor from "@anchor-lang/core";
import { BN, BorshCoder, EventParser, Program } from "@anchor-lang/core";
import { createAssociatedTokenAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { expect } from "chai";
import { Leash } from "../target/types/leash";

export const USDC = (n: number) => new BN(n * 1_000_000);
/** The same amount as the bigint that token balances come back as. */
export const units = (n: number) => BigInt(n) * 1_000_000n;
export const FAR_FUTURE = () => new BN(Math.floor(Date.now() / 1000) + 86_400);
export const REASON = Array.from(Buffer.alloc(32, 9));

// Set both: rpc options replace the provider defaults, and with no preflightCommitment
// the simulation runs against a bank too old to know the fresh blockhash.
export const CONFIRMED = { commitment: "confirmed", preflightCommitment: "confirmed" } as const;

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
export const program = anchor.workspace.leash as Program<Leash>;
export const connection = provider.connection;
export const payer = (provider.wallet as anchor.Wallet).payer;
const parser = new EventParser(program.programId, new BorshCoder(program.idl));

/** dUSDC, created once for the whole run. */
export let mint: PublicKey;
before(async () => {
  mint = await createMint(connection, payer, payer.publicKey, null, 6, undefined, CONFIRMED);
});

export const pda = (...seeds: (string | PublicKey | Buffer)[]) =>
  PublicKey.findProgramAddressSync(
    seeds.map((s) =>
      typeof s === "string" ? Buffer.from(s) : Buffer.isBuffer(s) ? s : s.toBuffer()
    ),
    program.programId
  )[0];

export const pendingPda = (vault: PublicKey, nonce: BN) =>
  pda("pending", vault, nonce.toArrayLike(Buffer, "le", 8));

export async function fund(key: PublicKey) {
  const sig = await connection.requestAirdrop(key, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

export async function funded(): Promise<Keypair> {
  const kp = Keypair.generate();
  await fund(kp.publicKey);
  return kp;
}

export const tokenAccount = (owner: PublicKey) =>
  createAssociatedTokenAccount(connection, payer, mint, owner, CONFIRMED);

/** A fresh owner holding 1000 dUSDC, with an initialized vault. */
export async function newVault(withDevice = true) {
  const owner = await funded();
  const agent = Keypair.generate();
  const guard = Keypair.generate();
  const device = withDevice ? await funded() : null;
  const vault = pda("vault", owner.publicKey);
  const vaultToken = pda("vault_token", vault);
  const ownerToken = await tokenAccount(owner.publicKey);
  await mintTo(connection, payer, mint, ownerToken, payer, 1000 * 1_000_000, [], CONFIRMED);
  const initSig = await program.methods
    .initVault(agent.publicKey, guard.publicKey, device?.publicKey ?? null)
    .accountsPartial({ owner: owner.publicKey, vault, mint, vaultTokenAccount: vaultToken })
    .signers([owner])
    .rpc(CONFIRMED);
  return { owner, agent, guard, device, vault, vaultToken, ownerToken, initSig };
}

export type Ctx = Awaited<ReturnType<typeof newVault>>;

export const deposit = (v: Ctx, amount: BN) =>
  program.methods
    .deposit(amount)
    .accountsPartial({
      owner: v.owner.publicKey,
      vault: v.vault,
      mint,
      ownerTokenAccount: v.ownerToken,
      vaultTokenAccount: v.vaultToken,
    })
    .signers([v.owner])
    .rpc(CONFIRMED);

export const setMandate = (
  v: Ctx,
  low: BN,
  perTx: BN,
  daily: BN,
  opts: { expiresAt?: BN; windowSecs?: BN; pendingTtlSecs?: BN } = {}
) =>
  program.methods
    .setMandate({
      lowThreshold: low,
      perTxMax: perTx,
      dailyCap: daily,
      expiresAt: opts.expiresAt ?? FAR_FUTURE(),
      windowSecs: opts.windowSecs ?? null,
      pendingTtlSecs: opts.pendingTtlSecs ?? null,
    })
    .accountsPartial({
      owner: v.owner.publicKey,
      vault: v.vault,
      mandate: pda("mandate", v.vault),
    })
    .signers([v.owner])
    .rpc(CONFIRMED);

export const rotate = (
  v: Ctx,
  keys: { agent?: PublicKey; guard?: PublicKey; device?: PublicKey },
  signer: Keypair = v.owner
) =>
  program.methods
    .rotateKeys(keys.agent ?? null, keys.guard ?? null, keys.device ?? null)
    .accountsPartial({ owner: signer.publicKey, vault: v.vault })
    .signers([signer])
    .rpc(CONFIRMED);

export const revoke = (v: Ctx, signer: Keypair) =>
  program.methods
    .revokeAgent()
    .accountsPartial({ authority: signer.publicKey, vault: v.vault })
    .signers([signer])
    .rpc(CONFIRMED);

export const unpause = (v: Ctx, signer: Keypair = v.owner) =>
  program.methods
    .unpause()
    .accountsPartial({ owner: signer.publicKey, vault: v.vault })
    .signers([signer])
    .rpc(CONFIRMED);

export const withdraw = (
  v: Ctx,
  amount: BN,
  signer: Keypair = v.owner,
  to: PublicKey = v.ownerToken
) =>
  program.methods
    .withdraw(amount)
    .accountsPartial({
      owner: signer.publicKey,
      vault: v.vault,
      mint,
      ownerTokenAccount: to,
      vaultTokenAccount: v.vaultToken,
    })
    .signers([signer])
    .rpc(CONFIRMED);

export const addRecipient = (
  v: Ctx,
  recipient: PublicKey,
  signer: Keypair = v.owner,
  cap: BN = USDC(50)
) =>
  program.methods
    .addRecipient(recipient, Array.from(Buffer.alloc(32, 7)), cap)
    .accountsPartial({
      owner: signer.publicKey,
      vault: v.vault,
      allowEntry: pda("allow", v.vault, recipient),
    })
    .signers([signer])
    .rpc(CONFIRMED);

export const balance = async (account: PublicKey) =>
  (await getAccount(connection, account, "confirmed")).amount;

export async function expectError(attempt: Promise<unknown>, code: string) {
  let error: any;
  try {
    await attempt;
  } catch (e) {
    error = e;
  }
  expect(error, `expected ${code}, but the transaction succeeded`).to.exist;
  expect(error.error?.errorCode?.code, String(error)).to.equal(code);
}

async function logsOf(signature: string): Promise<string[]> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  return tx!.meta!.logMessages!;
}

/** The named event's data from a transaction. Fails the test if it was not emitted. */
export async function eventOf(signature: string, name: string): Promise<any> {
  const events = [...parser.parseLogs(await logsOf(signature))];
  const event = events.find((e) => e.name === name);
  expect(event, `no ${name} in [${events.map((e) => e.name)}]`).to.exist;
  return event!.data;
}

export async function expectEvent(signature: string, name: string) {
  await eventOf(signature, name);
}

/** Compute units the Leash program consumed, from the tx log's "consumed N of" line. */
export async function computeUnits(signature: string): Promise<number> {
  const line = (await logsOf(signature)).find((l) =>
    l.startsWith(`Program ${program.programId.toBase58()} consumed `)
  );
  return Number(line!.split(" ")[3]);
}

/** The cluster's clock, in unix seconds. Slot time and wall time can differ, so tests use this. */
export async function clockNow(): Promise<number> {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  return Number(info!.data.readBigInt64LE(32));
}

/** Waits until the cluster's clock reaches `target`. */
export async function waitForClock(target: number) {
  while ((await clockNow()) < target) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
