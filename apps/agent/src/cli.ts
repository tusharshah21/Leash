// pnpm agent [--vault <address>] "<task>". Holds only the agent key.
import { notifyPending } from "./notify.ts";
import { parseArgs } from "node:util";
import { appendActivity, clientFor, readKeypair, redact } from "@leash/sdk/node";
import OpenAI from "openai";
import { guardSigner, requestReview } from "./guard-client.ts";
import { runLoop } from "./loop.ts";
import { definitions, makeTools } from "./tools.ts";

const args = parseArgs({ allowPositionals: true, options: { vault: { type: "string" } } });
const task = args.positionals.join(" ").trim();
if (!task) throw new Error('Usage: pnpm agent [--vault <address>] "<task>"');
if (args.values.vault) process.env.LEASH_VAULT = args.values.vault;
const model = process.env.OPENAI_MODEL;
if (!model) throw new Error("Set OPENAI_MODEL");

const agent = readKeypair(process.env.AGENT_KEY_FILE || "keys/agent.json");
const client = await clientFor(agent);
const guardUrl = process.env.GUARD_URL || "http://127.0.0.1:8787";
const { guard } = await client.fetchVault();
if (!guard) throw new Error("The vault has no guard key");
const log = (line: string) => console.log(redact(line));

log(`Vault ${client.vault}, model ${model}`);
log(`Task: ${task}\n`);

const run = makeTools({
  client,
  invoicesDir: process.env.LEASH_INVOICES_DIR || "demo/invoices",
  review: (proposal, nonce) => requestReview(guardUrl, { userTask: task, proposal, nonce }),
  notify: (notice) => notifyPending(notice),
  log,
  makeGuard: (proposal, onDecision) =>
    guardSigner({
      url: guardUrl,
      agent,
      guard,
      userTask: task,
      proposal,
      onDecision,
    }),
});

const result = await runLoop({
  client: new OpenAI(),
  model,
  task,
  tools: definitions,
  run,
  log,
  onUsage: (inputTokens, outputTokens) =>
    appendActivity({ actor: "agent", kind: "usage", inputTokens, outputTokens }),
});
log(`\nDone in ${result.steps} steps.`);
// pdf.js and the RPC client keep handles open.
process.exit(result.finished ? 0 : 1);
