// pnpm demo:snapshot [--vault <address>]. Exports the dashboard's offchain data for a deployed site,
// which has no logs folder. Whitelisted fields only, and redacted.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type ActivityEntry, sanitizeActivity } from "@leash/sdk";
import { readJsonl, redact } from "@leash/sdk/node";

const OUT = new URL("../apps/web/public/activity-snapshot.json", import.meta.url);
const { vault } = parseArgs({ options: { vault: { type: "string" } } }).values;
const entries = sanitizeActivity(readJsonl<ActivityEntry>("activity.jsonl"), vault);
writeFileSync(OUT, redact(JSON.stringify(entries, null, 2)) + "\n");
console.log(`Wrote ${entries.length} entries to apps/web/public/activity-snapshot.json`);
