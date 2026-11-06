// The guard service. Holds only the guard key, and listens on localhost only.
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { pendingPda, PROGRAM_ID } from "@leash/sdk";
import {
  appendActivity,
  appendJsonl,
  clientFor,
  readJsonl,
  readKeypair,
  redact,
} from "@leash/sdk/node";
import OpenAI from "openai";
import { openAiJudge } from "./judge.ts";
import { cosign, type Deps, review } from "./pipeline.ts";
import type { Decision } from "./rules.ts";

const MAX_BODY = 64 * 1024;
const model = process.env.OPENAI_MODEL;
if (!model) throw new Error("Set OPENAI_MODEL");
const port = Number(process.env.GUARD_PORT || 8787);

const guardKey = readKeypair(process.env.GUARD_KEY_FILE || "keys/guard.json");
const { vault: vaultArg } = parseArgs({ options: { vault: { type: "string" } } }).values;
if (vaultArg) process.env.LEASH_VAULT = vaultArg;
const client = await clientFor(guardKey);
const vaultAccount = await client.fetchVault();
if (!vaultAccount.guard?.equals(guardKey.publicKey)) {
  throw new Error("This key is not the vault's guard");
}

const deps: Deps = {
  ctx: {
    programId: PROGRAM_ID,
    vault: client.vault,
    mandate: client.mandate,
    vaultToken: client.vaultToken,
    mint: vaultAccount.mint,
    agent: vaultAccount.agent,
    guard: guardKey.publicKey,
  },
  guardKey,
  async chainState(recipient, amount) {
    const [vault, mandate, list, tier] = await Promise.all([
      client.fetchVault(),
      client.fetchMandate(),
      client.fetchAllowlist(),
      client.classify(amount, recipient),
    ]);
    return {
      paused: vault.paused,
      expired: mandate.expiresAt.toNumber() <= Date.now() / 1000,
      allowlisted: list.some((e) => e.recipient.equals(recipient)),
      tier,
    };
  },
  vendors: async () =>
    (await client.fetchAllowlist()).map((e) => ({
      name: e.label,
      address: e.recipient.toBase58(),
    })),
  judge: openAiJudge(new OpenAI(), model, (inputTokens, outputTokens) =>
    appendActivity({ actor: "guard", kind: "usage", inputTokens, outputTokens })
  ),
  history: () => readJsonl<Decision>("guard.jsonl"),
  async pendingAction(nonce) {
    const p = await client.program.account.pendingAction.fetchNullable(
      pendingPda(client.vault, nonce)
    );
    return (
      p && {
        recipient: p.recipient,
        amount: BigInt(p.amount.toString()),
        reasonHash: Array.from(p.reasonHash),
      }
    );
  },
  recordReview(r) {
    appendJsonl("guard.jsonl", r);
    appendActivity({ actor: "guard", ...r });
  },
  record(d) {
    appendJsonl("guard.jsonl", d);
    appendActivity({
      actor: "guard",
      kind: "cosign",
      vault: d.vault,
      amount: d.amount,
      recipient: d.recipient,
      memo: d.memo,
      reasoning: d.reasoning,
      verdict: d.decision,
      risk: d.risk,
      rationale: d.rationale,
    });
  },
};

// One at a time, so two identical requests cannot both pass the duplicate check.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>) => {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
};

const server = createServer(async (req, res) => {
  const reply = (status: number, body: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") {
    return reply(200, { ok: true, vault: client.vault.toBase58() });
  }
  const handler = req.url === "/cosign" ? cosign : req.url === "/review" ? review : null;
  if (req.method !== "POST" || !handler) return reply(404, { error: "not found" });

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return reply(413, { verdict: "deny", rationale: "body too large" });
      chunks.push(chunk);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const { status, ...body } = await serial<Awaited<ReturnType<typeof handler>>>(() =>
      handler(parsed, deps)
    );
    const verdict = "verdict" in body ? body.verdict : "refused";
    const risk = "risk" in body ? ` risk=${body.risk ?? "-"}` : "";
    const name = handler === review ? "review" : "guard";
    console.log(redact(`${name} ${verdict}${risk}: ${body.rationale}`));
    reply(status, body);
  } catch (err) {
    console.error(redact(`guard error: ${String((err as Error)?.message ?? err)}`));
    reply(400, { verdict: "deny", rationale: "bad request" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Guard for vault ${client.vault} on 127.0.0.1:${port}, model ${model}`);
});
