// Shared by the devnet scripts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import anchor from "@anchor-lang/core";
import { Connection, Keypair, type PublicKey } from "@solana/web3.js";

export const { AnchorProvider, BN, Wallet } = anchor;

export const RPC = process.env.LEASH_RPC_URL || "https://api.devnet.solana.com";
export const connection = new Connection(RPC, "confirmed");
export const CONFIRMED = { commitment: "confirmed", preflightCommitment: "confirmed" } as const;
export const dusdc = (n: number) => BigInt(n) * 1_000_000n;

const KEYS_DIR = new URL("../keys/", import.meta.url);

const readKeypair = (path: string | URL) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));

/** The deploy wallet: pays for setup and is the dUSDC mint authority. */
export const cliWallet = () =>
  readKeypair(process.env.ANCHOR_WALLET ?? `${homedir()}/.config/solana/id.json`);

/** Loads keys/<name>.json, creating it first if `create` is set. */
export function demoKey(name: string, create = false): Keypair {
  const path = new URL(`${name}.json`, KEYS_DIR);
  if (existsSync(path)) return readKeypair(path);
  if (!create) throw new Error(`keys/${name}.json is missing. Run the bootstrap script first.`);
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const key = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(key.secretKey)), { mode: 0o600 });
  return key;
}

export const providerFor = (key: Keypair) =>
  new AnchorProvider(connection, new Wallet(key), CONFIRMED);

export const addressLink = (key: PublicKey | string) =>
  `https://explorer.solana.com/address/${key.toString()}?cluster=devnet`;
export const txLink = (signature: string) =>
  `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

export const DEVNET_JSON = new URL("../demo/devnet.json", import.meta.url);
