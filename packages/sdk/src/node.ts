/// <reference types="node" />
// Node-only helpers for the agent, the guard and the scripts. Kept off the main entry so that
// stays usable in a browser.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { ActivityEntry } from "./activity.js";
import { LeashClient } from "./client.js";

const { AnchorProvider, Wallet } = anchor;

const SECRETS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]"],
  [/(api[-_]?key=)[^\s&"]+/gi, "$1[redacted]"],
  [/(bearer\s+)[^\s"]+/gi, "$1[redacted]"],
];

/** Strips API keys and RPC tokens from text bound for a log or the console. */
export const redact = (text: string) =>
  SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);

export const logDir = () => process.env.LEASH_LOG_DIR || "logs";

/** Appends a redacted JSON line. Throws if it cannot, so the guard can refuse to sign unlogged. */
export function appendJsonl(file: string, entry: object) {
  mkdirSync(logDir(), { recursive: true });
  appendFileSync(join(logDir(), file), redact(JSON.stringify(entry)) + "\n");
}

export function readJsonl<T>(file: string): T[] {
  const path = join(logDir(), file);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function appendActivity(entry: Omit<ActivityEntry, "ts" | "runId">) {
  const runId = process.env.LEASH_RUN_ID;
  appendJsonl("activity.jsonl", {
    ts: new Date().toISOString(),
    ...(runId ? { runId } : {}),
    ...entry,
  });
}

export const readKeypair = (path: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));

export const CONFIRMED = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
} as const;

export const rpcUrl = () => process.env.LEASH_RPC_URL || "https://api.devnet.solana.com";

export const providerFor = (key: Keypair) =>
  new AnchorProvider(new Connection(rpcUrl(), "confirmed"), new Wallet(key), CONFIRMED);

/** The vault owner to act for: LEASH_VAULT_OWNER, else the fresh demo vault, else the main one. */
export function vaultOwner(devnetJsonPath = "demo/devnet.json"): PublicKey {
  if (process.env.LEASH_VAULT_OWNER) return new PublicKey(process.env.LEASH_VAULT_OWNER);
  const demo = JSON.parse(readFileSync(devnetJsonPath, "utf8"));
  return new PublicKey(demo.demoVault?.owner ?? demo.owner.address);
}

/** A client signing as `key`, for the vault in LEASH_VAULT if set, else as `vaultOwner` picks. */
export async function clientFor(key: Keypair) {
  const provider = providerFor(key);
  return process.env.LEASH_VAULT
    ? LeashClient.forVault(provider, new PublicKey(process.env.LEASH_VAULT))
    : new LeashClient(provider, vaultOwner());
}
