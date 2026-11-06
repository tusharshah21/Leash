// Offchain activity for the console: guard decisions and the agent's reasoning. In file mode it
// reads the local log. Otherwise it points at the exported snapshot, so a deployed site can never
// serve a log file. Chain data does not come through here.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ActivityEntry, sanitizeActivity } from "@leash/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOG = resolve(process.cwd(), "../../logs/activity.jsonl");
const SECRET = /sk-[A-Za-z0-9_-]{8,}|api[-_]?key=[^\s&"]+/gi;

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (process.env.ACTIVITY_SOURCE !== "file") {
    return NextResponse.redirect(new URL("/activity-snapshot.json", url), 307);
  }
  const vault = url.searchParams.get("vault");
  if (!vault) return NextResponse.json({ error: "vault is required" }, { status: 400 });

  let text = "";
  try {
    text = await readFile(LOG, "utf8");
  } catch {
    return NextResponse.json([]); // No runs yet.
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
  const body = JSON.stringify(sanitizeActivity(entries, vault)).replace(SECRET, "[redacted]");
  return new NextResponse(body, { headers: { "content-type": "application/json" } });
}
