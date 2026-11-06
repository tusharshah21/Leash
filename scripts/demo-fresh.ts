// A new owner, vault and mandate, so a demo run starts with spent_today = 0. Reuses the agent,
// guard, device, vendor and attacker keys and the dUSDC mint.
import { readFileSync, writeFileSync } from "node:fs";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
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
} from "./common.ts";
import { setupVault } from "./setup-vault.ts";

const OWNER_SOL = 0.012; // vault, mandate, token account and three allowlist rents, plus fees
const AGENT_TARGET_SOL = 0.02;
const AGENT_MIN_SOL = 0.01; // two proposals' rent and fees per run
const DEPOSIT = dusdc(2_000);

const payer = cliWallet();
const start = await connection.getBalance(payer.publicKey);
const demo = JSON.parse(readFileSync(DEVNET_JSON, "utf8"));

const transfer = (to: PublicKey, lamports: number) =>
  sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports })
    ),
    [payer],
    CONFIRMED
  );

const name = `demo-owner-${Date.now()}`;
const owner = demoKey(name, true);
const agent = demoKey("agent");
await transfer(owner.publicKey, Math.round(OWNER_SOL * LAMPORTS_PER_SOL));

const agentBalance = await connection.getBalance(agent.publicKey);
if (agentBalance < AGENT_MIN_SOL * LAMPORTS_PER_SOL) {
  await transfer(agent.publicKey, Math.round(AGENT_TARGET_SOL * LAMPORTS_PER_SOL) - agentBalance);
  console.log(`Topped the agent up to ${AGENT_TARGET_SOL} SOL`);
}

const mint = demoKey("dusdc-mint").publicKey;
const ownerToken = await getOrCreateAssociatedTokenAccount(
  connection,
  payer,
  mint,
  owner.publicKey,
  false,
  "confirmed",
  CONFIRMED
);

const client = await setupVault({
  payer,
  owner,
  agent: agent.publicKey,
  guard: demoKey("guard").publicKey,
  device: demoKey("device").publicKey,
  mint,
  ownerToken: ownerToken.address,
  vendors: demo.vendors.map((v: { name: string; address: string }) => ({
    name: v.name,
    wallet: new PublicKey(v.address),
  })),
  ownerMint: DEPOSIT,
  deposit: DEPOSIT,
  step: (done, label) => console.log(`${done ? "skip" : "do  "}  ${label}`),
});

demo.demoVault = {
  keyFile: `keys/${name}.json`,
  owner: owner.publicKey.toBase58(),
  vault: client.vault.toBase58(),
  explorer: addressLink(client.vault),
  tokenAccount: client.vaultToken.toBase58(),
  mandate: client.mandate.toBase58(),
  createdAt: new Date().toISOString(),
};
writeFileSync(DEVNET_JSON, JSON.stringify(demo, null, 2) + "\n");

const left = await connection.getBalance(payer.publicKey);
console.log(`\nFresh vault ${addressLink(client.vault)}`);
console.log(
  `SOL used: ${((start - left) / LAMPORTS_PER_SOL).toFixed(6)}. Wallet left: ${(
    left / LAMPORTS_PER_SOL
  ).toFixed(6)}`
);
process.exit(0);
