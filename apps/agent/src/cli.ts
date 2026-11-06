// pnpm agent "<task>". Holds only the agent key.
import { LeashClient } from "@leash/sdk";
import { appendActivity, providerFor, readKeypair, redact, vaultOwner } from "@leash/sdk/node";
import OpenAI from "openai";
import { guardSigner } from "./guard-client.ts";
import { runLoop } from "./loop.ts";
import { definitions, makeTools } from "./tools.ts";

const task = process.argv.slice(2).join(" ").trim();
if (!task) throw new Error('Usage: pnpm agent "<task>"');
const model = process.env.OPENAI_MODEL;
if (!model) throw new Error("Set OPENAI_MODEL");

const agent = readKeypair(process.env.AGENT_KEY_FILE || "keys/agent.json");
const client = new LeashClient(providerFor(agent), vaultOwner());
const { guard } = await client.fetchVault();
if (!guard) throw new Error("The vault has no guard key");
const log = (line: string) => console.log(redact(line));

log(`Vault ${client.vault}, model ${model}`);
log(`Task: ${task}\n`);

const run = makeTools({
  client,
  invoicesDir: process.env.LEASH_INVOICES_DIR || "demo/invoices",
  log,
  makeGuard: (proposal, onDecision) =>
    guardSigner({
      url: process.env.GUARD_URL || "http://127.0.0.1:8787",
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
