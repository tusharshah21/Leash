// Devnet addresses and connections. Everything here is public.
import { AnchorProvider, type Wallet } from "@anchor-lang/core";
import { type Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import devnet from "../../../demo/devnet.json";

export const RPC_URL = process.env.NEXT_PUBLIC_LEASH_RPC_URL || "https://api.devnet.solana.com";

export const PROGRAM = devnet.programId.address;
export const DEMO_VAULT = devnet.demoVault?.vault ?? devnet.vault.address;
export const MINT = new PublicKey(devnet.mint.address);
export const VENDORS = devnet.vendors.map((v) => ({
  name: v.name,
  address: v.address,
  tokenAccount: v.tokenAccount,
}));
export const KEYS = {
  agent: new PublicKey(devnet.agent.address),
  guard: new PublicKey(devnet.guard.address),
  device: new PublicKey(devnet.device.address),
};

/** Known token accounts, for naming the recipient of a failed transaction. */
export const WALLET_BY_TOKEN_ACCOUNT = new Map([
  ...VENDORS.map((v): [string, string] => [v.tokenAccount, v.address]),
  [devnet.attacker.tokenAccount, devnet.attacker.address],
]);

const OPTIONS = { commitment: "confirmed", preflightCommitment: "confirmed" } as const;

export const providerFor = (connection: Connection, wallet: Wallet | AnchorWalletLike) =>
  new AnchorProvider(connection, wallet as Wallet, OPTIONS);

export interface AnchorWalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]>;
}

const refuse = () => Promise.reject(new Error("Connect a wallet to do this"));

/** For reading a vault with no wallet connected. Any attempt to sign fails. */
export const readOnlyWallet: AnchorWalletLike = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: refuse,
  signAllTransactions: refuse,
};

export const addressUrl = (address: string) =>
  `https://explorer.solana.com/address/${address}?cluster=devnet`;
export const txUrl = (signature: string) =>
  `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

/** dUSDC from base units, for display. */
export const dusdc = (base: string | number | bigint) =>
  (Number(base) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

export const short = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;
