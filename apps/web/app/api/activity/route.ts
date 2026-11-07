// Offchain activity for the console: guard decisions and the agent's reasoning. In file mode it
// reads the local log. Otherwise it points at the exported snapshot, so a deployed site can never
// serve a log file. Chain data does not come through here.
import { NextResponse } from "next/server";
import { activityFromFile, readActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!activityFromFile()) {
    return NextResponse.redirect(new URL("/activity-snapshot.json", url), 307);
  }
  const vault = url.searchParams.get("vault");
  if (!vault) return NextResponse.json({ error: "vault is required" }, { status: 400 });
  return NextResponse.json(await readActivity(vault));
}
