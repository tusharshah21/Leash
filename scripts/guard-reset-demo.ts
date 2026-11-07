// pnpm guard:reset-demo --vault <address>. Clears one vault's guard history, so a demo retake is not
// refused as a duplicate. Other vaults keep theirs, and the removed lines go to an archive.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { logDir } from "@leash/sdk/node";
import { PublicKey } from "@solana/web3.js";
import { splitByVault } from "../apps/guard/src/rules.ts";

const { vault } = parseArgs({ options: { vault: { type: "string" } } }).values;
if (!vault) throw new Error("Usage: pnpm guard:reset-demo --vault <address>");
new PublicKey(vault); // Throws on a typo, rather than quietly removing nothing.

const log = join(logDir(), "guard.jsonl");
if (!existsSync(log)) {
  console.log(`Nothing to clear: ${log} does not exist.`);
  process.exit(0);
}
const { keep, removed } = splitByVault(readFileSync(log, "utf8").split("\n"), vault);
if (removed.length) {
  appendFileSync(join(logDir(), "guard-archive.jsonl"), removed.join("\n") + "\n");
  const temp = `${log}.tmp`;
  writeFileSync(temp, keep.length ? keep.join("\n") + "\n" : "");
  renameSync(temp, log);
}
console.log(
  `Cleared ${removed.length} entries for ${vault}. ${keep.length} remain for other vaults.`
);
