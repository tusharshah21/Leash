// Sets up the demo vault on devnet. Safe to rerun: each step checks the chain and skips if done.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { allowPda, PROGRAM_ID } from "@leash/sdk";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  addressLink,
  cliWallet,
  CONFIRMED,
  connection,
  demoKey,
  DEVNET_JSON,
  dusdc,
  RPC,
} from "./common.ts";
import { setupVault } from "./setup-vault.ts";

const BROWSER_WALLET = new PublicKey("J2nBcSoqjH662JZ5U2uTVb1QuaDir8e6kkKaswrtEukq");
const VENDORS = [
  ["Acme Design", "vendor-acme"],
  ["CloudHost Inc", "vendor-cloudhost"],
  ["DataLabs", "vendor-datalabs"],
] as const;

const OWNER_MINT = dusdc(10_000);
const BROWSER_MINT = dusdc(500);
const VAULT_DEPOSIT = dusdc(2_000);

// Enough for fees and proposal rent. The owner also pays vault and allowlist rent.
const FUNDING_SOL = { owner: 0.05, agent: 0.02, guard: 0.005, device: 0.005 };

const step = (done: boolean, label: string) => console.log(`${done ? "skip" : "do  "}  ${label}`);

const payer = cliWallet();
const startBalance = await connection.getBalance(payer.publicKey);
console.log(`RPC: ${RPC.split("?")[0]}\nPayer: ${payer.publicKey}\n`);

const owner = demoKey("owner", true);
const agent = demoKey("agent", true);
const guard = demoKey("guard", true);
const device = demoKey("device", true);
const attacker = demoKey("attacker", true);
const mintKey = demoKey("dusdc-mint", true);
const vendors = VENDORS.map(([name, file]) => ({ name, key: demoKey(file, true) }));

// SOL for the keys that sign.
for (const [name, key] of [
  ["owner", owner],
  ["agent", agent],
  ["guard", guard],
  ["device", device],
] as const) {
  const target = Math.round(FUNDING_SOL[name] * LAMPORTS_PER_SOL);
  const current = await connection.getBalance(key.publicKey);
  const missing = target - current;
  // Tops up only when low, so rent the owner already paid does not count as a shortfall on a rerun.
  const enough = current >= target / 2;
  step(enough, `fund ${name} to ${FUNDING_SOL[name]} SOL`);
  if (!enough) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: key.publicKey,
        lamports: missing,
      })
    );
    await sendAndConfirmTransaction(connection, tx, [payer], CONFIRMED);
  }
}

// dUSDC and token accounts.
const mint = mintKey.publicKey;
const mintExists = (await connection.getAccountInfo(mint)) !== null;
step(mintExists, "create dUSDC mint");
if (!mintExists) {
  await createMint(connection, payer, payer.publicKey, null, 6, mintKey, CONFIRMED);
}

const ata = async (wallet: PublicKey) =>
  (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      wallet,
      false,
      "confirmed",
      CONFIRMED
    )
  ).address;

const ownerToken = await ata(owner.publicKey);
const browserToken = await ata(BROWSER_WALLET);
const attackerToken = await ata(attacker.publicKey);
const vendorTokens: PublicKey[] = [];
for (const v of vendors) vendorTokens.push(await ata(v.key.publicKey));
console.log("done  token accounts");

const amountOf = async (account: PublicKey) =>
  (await getAccount(connection, account, "confirmed")).amount;

const browserFunded = (await amountOf(browserToken)) > 0n;
step(browserFunded, "mint 500 dUSDC to browser wallet");
if (!browserFunded) {
  await mintTo(connection, payer, mint, browserToken, payer, BROWSER_MINT, [], CONFIRMED);
}

const { program, vault, mandate, vaultToken } = await setupVault({
  payer,
  owner,
  agent: agent.publicKey,
  guard: guard.publicKey,
  device: device.publicKey,
  mint,
  ownerToken,
  vendors: vendors.map((v) => ({ name: v.name, wallet: v.key.publicKey })),
  ownerMint: OWNER_MINT,
  deposit: VAULT_DEPOSIT,
  step,
});

// Public addresses for the dashboard and the agent. No secrets.
const ref = (key: PublicKey) => ({ address: key.toBase58(), explorer: addressLink(key) });
const onchain = await program.account.mandate.fetch(mandate);
const previous = existsSync(DEVNET_JSON) ? JSON.parse(readFileSync(DEVNET_JSON, "utf8")) : {};
const out = {
  cluster: "devnet",
  programId: ref(PROGRAM_ID),
  deployWallet: ref(payer.publicKey),
  browserWallet: { ...ref(BROWSER_WALLET), tokenAccount: browserToken.toBase58() },
  mint: { ...ref(mint), symbol: "dUSDC", decimals: 6 },
  owner: { ...ref(owner.publicKey), tokenAccount: ownerToken.toBase58() },
  agent: ref(agent.publicKey),
  guard: ref(guard.publicKey),
  device: ref(device.publicKey),
  vault: { ...ref(vault), tokenAccount: vaultToken.toBase58(), mandate: mandate.toBase58() },
  mandate: {
    lowThreshold: onchain.lowThreshold.toString(),
    perTxMax: onchain.perTxMax.toString(),
    dailyCap: onchain.dailyCap.toString(),
    expiresAt: onchain.expiresAt.toNumber(),
    windowSecs: onchain.windowSecs.toNumber(),
    pendingTtlSecs: onchain.pendingTtlSecs.toNumber(),
  },
  vendors: vendors.map((v, i) => ({
    name: v.name,
    ...ref(v.key.publicKey),
    tokenAccount: vendorTokens[i].toBase58(),
    allowEntry: allowPda(vault, v.key.publicKey).toBase58(),
  })),
  attacker: { ...ref(attacker.publicKey), tokenAccount: attackerToken.toBase58() },
  ...(previous.demoVault ? { demoVault: previous.demoVault } : {}),
};
writeFileSync(DEVNET_JSON, JSON.stringify(out, null, 2) + "\n");

const rows: [string, PublicKey][] = [
  ["Program", PROGRAM_ID],
  ["dUSDC mint", mint],
  ["Vault", vault],
  ["Vault tokens", vaultToken],
  ["Owner", owner.publicKey],
  ["Agent", agent.publicKey],
  ["Guard", guard.publicKey],
  ["Device", device.publicKey],
  ...vendors.map((v): [string, PublicKey] => [v.name, v.key.publicKey]),
  ["Attacker", attacker.publicKey],
  ["Browser wallet", BROWSER_WALLET],
];
console.log();
for (const [name, key] of rows) console.log(`${name.padEnd(15)} ${addressLink(key)}`);

const spent = startBalance - (await connection.getBalance(payer.publicKey));
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(6);
console.log(`\nVault holds ${Number(await amountOf(vaultToken)) / 1e6} dUSDC`);
console.log(`Spent this run: ${sol(spent)} SOL. Wallet left: ${sol(startBalance - spent)} SOL`);
console.log(`Wrote demo/devnet.json`);
console.log(
  `\nBack up ./keys/ outside the repo. It is gitignored, and it controls the demo vault.`
);
