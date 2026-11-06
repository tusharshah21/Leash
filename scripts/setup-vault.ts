// Vault, mandate, allowlist and funds, shared by bootstrap-devnet and demo-fresh. Each step checks
// the chain and skips if done.
import { allowPda, LeashClient } from "@leash/sdk";
import { getAccount, mintTo } from "@solana/spl-token";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { BN, CONFIRMED, connection, dusdc, providerFor } from "./common.ts";

const MANDATE = {
  lowThreshold: dusdc(25),
  perTxMax: dusdc(200),
  dailyCap: dusdc(500),
  windowSecs: 86_400,
  pendingTtlSecs: 86_400,
  expiresInSecs: 7 * 86_400,
};
const PER_RECIPIENT_CAP = dusdc(200);

const bn = (x: bigint) => new BN(x.toString());

export interface SetupOptions {
  /** Pays the mint fees, and is the dUSDC mint authority. */
  payer: Keypair;
  owner: Keypair;
  agent: PublicKey;
  guard: PublicKey;
  device: PublicKey;
  mint: PublicKey;
  ownerToken: PublicKey;
  vendors: { name: string; wallet: PublicKey }[];
  ownerMint: bigint;
  deposit: bigint;
  step(done: boolean, label: string): void;
}

export async function setupVault(o: SetupOptions) {
  const client = new LeashClient(providerFor(o.owner), o.owner.publicKey);
  const { program, vault, mandate, vaultToken } = client;
  const owner = o.owner.publicKey;

  const vaultExists = (await program.account.vault.fetchNullable(vault)) !== null;
  o.step(vaultExists, "init_vault");
  if (!vaultExists) {
    await program.methods
      .initVault(o.agent, o.guard, o.device)
      .accountsPartial({ owner, vault, mint: o.mint, vaultTokenAccount: vaultToken })
      .rpc(CONFIRMED);
  }

  const existing = await program.account.mandate.fetchNullable(mandate);
  const mandateLive = existing !== null && existing.expiresAt.toNumber() > Date.now() / 1000 + 3600;
  o.step(mandateLive, "set_mandate");
  if (!mandateLive) {
    await program.methods
      .setMandate({
        lowThreshold: bn(MANDATE.lowThreshold),
        perTxMax: bn(MANDATE.perTxMax),
        dailyCap: bn(MANDATE.dailyCap),
        expiresAt: new BN(Math.floor(Date.now() / 1000) + MANDATE.expiresInSecs),
        windowSecs: new BN(MANDATE.windowSecs),
        pendingTtlSecs: new BN(MANDATE.pendingTtlSecs),
      })
      .accountsPartial({ owner, vault, mandate })
      .rpc(CONFIRMED);
  }

  for (const v of o.vendors) {
    const entry = allowPda(vault, v.wallet);
    const listed = (await program.account.allowEntry.fetchNullable(entry)) !== null;
    o.step(listed, `allowlist ${v.name}`);
    if (!listed) {
      const label = Array.from(Buffer.concat([Buffer.from(v.name)], 32));
      await program.methods
        .addRecipient(v.wallet, label, bn(PER_RECIPIENT_CAP))
        .accountsPartial({ owner, vault, allowEntry: entry })
        .rpc(CONFIRMED);
    }
  }

  // Funds. Each mint and deposit runs only if there is nothing there yet.
  const amountOf = async (account: PublicKey) =>
    (await getAccount(connection, account, "confirmed")).amount;

  const ownerFunded = (await amountOf(o.ownerToken)) + (await amountOf(vaultToken)) > 0n;
  o.step(ownerFunded, `mint ${o.ownerMint / 1_000_000n} dUSDC to owner`);
  if (!ownerFunded) {
    await mintTo(connection, o.payer, o.mint, o.ownerToken, o.payer, o.ownerMint, [], CONFIRMED);
  }

  const vaultFunded = (await amountOf(vaultToken)) > 0n;
  o.step(vaultFunded, `deposit ${o.deposit / 1_000_000n} dUSDC into the vault`);
  if (!vaultFunded) {
    await program.methods
      .deposit(bn(o.deposit))
      .accountsPartial({
        owner,
        vault,
        mint: o.mint,
        ownerTokenAccount: o.ownerToken,
        vaultTokenAccount: vaultToken,
      })
      .rpc(CONFIRMED);
  }
  return client;
}
