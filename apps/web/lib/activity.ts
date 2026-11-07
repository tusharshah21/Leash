// Server only. The offchain log in file mode, otherwise the snapshot bundled at build time, so a
// deployed site can never read a log file. Chain data does not come through here.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ActivityEntry, sanitizeActivity } from "@leash/sdk";
import snapshot from "@/public/activity-snapshot.json";

const LOG = resolve(process.cwd(), "../../logs/activity.jsonl");
const SECRET = /sk-[A-Za-z0-9_-]{8,}|api[-_]?key=[^\s&"]+/gi;

export const activityFromFile = () => process.env.ACTIVITY_SOURCE === "file";

export async function readActivity(vault: string): Promise<ActivityEntry[]> {
  if (!activityFromFile()) {
    return sanitizeActivity(snapshot as unknown as ActivityEntry[], vault);
  }
  let text = "";
  try {
    text = await readFile(LOG, "utf8");
  } catch {
    return []; // No runs yet.
  }
  const entries: ActivityEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A line still being written. The next poll reads it whole.
    }
  }
  return JSON.parse(JSON.stringify(sanitizeActivity(entries, vault)).replace(SECRET, "[redacted]"));
}
