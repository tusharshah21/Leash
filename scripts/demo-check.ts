// pnpm demo:check [--vault <address>] [--site <url>]. Read-only preflight before recording: checks the
// RPC, OpenAI, the guard port, key balances, the vault and its dUSDC, then prints GO or NO-GO.
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { LeashClient } from "@leash/sdk";
import { getAccount } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { cliWallet, connection, demoKey, DEVNET_JSON, providerFor, RPC } from "./common.ts";

const { vault: vaultArg, site } = parseArgs({
  options: { vault: { type: "string" }, site: { type: "string" } },
}).values;
const demo = JSON.parse(readFileSync(DEVNET_JSON, "utf8"));
const PORT = process.env.GUARD_PORT || "8787";
const DAY = 86_400;
// What one demo:run pays without a human: 18 + 120 + 45 + 60. The 340 is approved by a person.
const RUN_SPEND = 243_000_000n;
const APPROVE = 340_000_000n;

type Level = "OK" | "WARN" | "FAIL";
const results: { level: Level; name: string; detail: string }[] = [];
const report = (level: Level, name: string, detail: string) => {
  results.push({ level, name, detail });
  console.log(`${level.padEnd(4)}  ${name.padEnd(22)} ${detail}`);
};
const check = async (name: string, fn: () => Promise<[Level, string]>) => {
  try {
    const [level, detail] = await fn();
    report(level, name, detail);
  } catch (err) {
    report("FAIL", name, String((err as Error)?.message ?? err).split("\n")[0]);
  }
};
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
const usd = (base: bigint) => (Number(base) / 1e6).toLocaleString("en-US");
const host = RPC.replace(/\?.*$/, "").replace(/\/\/([^/]+).*/, "//$1");

console.log(`Leash demo preflight, ${new Date().toISOString()}\n`);

await check("RPC", async () => {
  const start = Date.now();
  const [slot, { blockhash }] = await Promise.all([
    connection.getSlot(),
    connection.getLatestBlockhash(),
  ]);
  const ms = Date.now() - start;
  const pub = /api\.devnet\.solana\.com/.test(RPC);
  return [
    ms > 3000 || pub ? "WARN" : "OK",
    `${host} slot ${slot}, ${ms} ms${blockhash ? "" : ", no blockhash"}${
      pub ? ", public endpoint (429s likely)" : ""
    }`,
  ];
});

await check("OpenAI", async () => {
  const { OPENAI_API_KEY: key, OPENAI_MODEL: model } = process.env;
  if (!key || !model) return ["FAIL", "OPENAI_API_KEY or OPENAI_MODEL is not set in .env"];
  const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok ? ["OK", `${model} reachable`] : ["FAIL", `${model}: HTTP ${res.status}`];
});

let vault: PublicKey;
try {
  vault = new PublicKey(vaultArg ?? demo.demoVault.vault);
} catch {
  report("FAIL", "Vault", "pass --vault <address>, or run pnpm demo:fresh");
  process.exit(1);
}

await check("Guard port", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null);
  if (!res) return ["OK", `${PORT} is free, demo:run starts its own guard`];
  const body = await res.json().catch(() => ({}));
  return [
    "FAIL",
    `a guard is already on ${PORT} (vault ${body.vault ?? "?"}). Stop it: demo:run starts its own`,
  ];
});

await check("Keys", async () => {
  const missing = ["agent", "guard", "device"].filter((k) => !existsSync(`keys/${k}.json`));
  return missing.length
    ? ["FAIL", `missing keys/${missing.join(", keys/")}.json`]
    : ["OK", "agent, guard, device"];
});

const agent = demoKey("agent");
const client = await LeashClient.forVault(providerFor(agent), vault).catch(() => null);
if (!client) {
  report("FAIL", "Vault", `${vault.toBase58()} does not exist on devnet`);
} else {
  const [state, mandate, allowlist, pending] = await Promise.all([
    client.fetchVault(),
    client.fetchMandate(),
    client.fetchAllowlist(),
    client.fetchPending(),
  ]);
  const now = Math.floor(Date.now() / 1000);

  await check("Vault", async () => {
    const problems = [];
    if (state.paused) problems.push("paused (unpause or recreate)");
    if (!state.agent.equals(agent.publicKey)) problems.push("agent is not keys/agent.json");
    if (!state.guard?.equals(demoKey("guard").publicKey))
      problems.push("guard is not keys/guard.json");
    return problems.length
      ? ["FAIL", problems.join("; ")]
      : ["OK", `${vault.toBase58()}, owner ${state.owner.toBase58()}`];
  });

  await check("Mandate", async () => {
    const expires = mandate.expiresAt.toNumber();
    const windowEnd = mandate.windowStart.toNumber() + mandate.windowSecs.toNumber();
    const spent = now >= windowEnd ? 0n : BigInt(mandate.spentToday.toString());
    const room = BigInt(mandate.dailyCap.toString()) - spent;
    if (expires <= now) return ["FAIL", "expired"];
    if (room < RUN_SPEND)
      return ["FAIL", `only ${usd(room)} dUSDC left under the daily cap, need 243`];
    return [
      expires - now < DAY ? "WARN" : "OK",
      `${usd(spent)} / ${usd(BigInt(mandate.dailyCap.toString()))} spent, expires in ${Math.floor(
        (expires - now) / 3600
      )}h`,
    ];
  });

  await check("Allowlist", async () => {
    const listed = new Set(allowlist.map((e) => e.recipient.toBase58()));
    const missing = demo.vendors.filter((v: { address: string }) => !listed.has(v.address));
    return missing.length
      ? ["FAIL", `missing ${missing.map((v: { name: string }) => v.name).join(", ")}`]
      : ["OK", allowlist.map((e) => e.label).join(", ")];
  });

  await check("Pending", async () => {
    const ttl = mandate.pendingTtlSecs.toNumber();
    const open = pending.filter((p) => "pending" in p.status && p.createdAt.toNumber() + ttl > now);
    return open.length
      ? ["WARN", `${open.length} already waiting, the console will show them beside the new ones`]
      : ["OK", "queue empty"];
  });

  await check("Guard history", async () => {
    const log = "logs/guard.jsonl";
    const since = Date.now() - DAY * 1000;
    const approvals = existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .filter(
            (e) =>
              e.vault === vault.toBase58() && e.decision === "approve" && Date.parse(e.ts) > since
          ).length
      : 0;
    return approvals
      ? [
          "FAIL",
          `${approvals} approvals in the last 24h would refuse retakes as duplicates. Run pnpm guard:reset-demo --vault ${vault.toBase58()}`,
        ]
      : ["OK", "no recent approvals for this vault"];
  });

  await check("Vault dUSDC", async () => {
    const amount = (await getAccount(connection, client.vaultToken, "confirmed")).amount;
    return amount < RUN_SPEND + APPROVE
      ? ["FAIL", `${usd(amount)}, need at least 583 (243 paid by the run, 340 approved)`]
      : ["OK", usd(amount)];
  });

  await check("Owner SOL", async () => {
    const lamports = await connection.getBalance(state.owner);
    return [
      lamports < 0.005 * LAMPORTS_PER_SOL ? "WARN" : "OK",
      `${sol(lamports)} (pays approve and reject fees)`,
    ];
  });
}

await check("Agent SOL", async () => {
  const lamports = await connection.getBalance(agent.publicKey);
  return [
    lamports < 0.005 * LAMPORTS_PER_SOL ? "WARN" : "OK",
    `${sol(lamports)}${
      lamports < 0.005 * LAMPORTS_PER_SOL ? ", demo:run tops it up from the CLI wallet" : ""
    }`,
  ];
});

await check("CLI wallet SOL", async () => {
  const lamports = await connection.getBalance(cliWallet().publicKey);
  return [lamports < 0.1 * LAMPORTS_PER_SOL ? "FAIL" : "OK", sol(lamports)];
});

await check("Attacker dUSDC", async () => {
  const account = new PublicKey(demo.attacker.tokenAccount);
  const amount = (await getAccount(connection, account, "confirmed")).amount;
  return ["OK", `${usd(amount)} (should not change during the run)`];
});

const url = site ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
await check("Console", async () => {
  const res = await fetch(`${url}/console/${vault.toBase58()}`, {
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return res?.ok
    ? ["OK", `${url}/console/${vault.toBase58()}`]
    : ["WARN", `${url} not reachable (pnpm dev:web?)`];
});

const fails = results.filter((r) => r.level === "FAIL").length;
const warns = results.filter((r) => r.level === "WARN").length;
console.log(`\n${fails ? "NO-GO" : "GO"}: ${fails} failed, ${warns} warnings`);
process.exit(fails ? 1 : 0);
