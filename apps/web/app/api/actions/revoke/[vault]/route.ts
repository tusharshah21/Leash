import { actionDeps, actionPreflight, answer } from "@/lib/actions-chain";
import { getRevoke, postRevoke } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const OPTIONS = actionPreflight;

export async function GET(request: Request, { params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  return answer(() => getRevoke(vault, actionDeps(request)));
}

export async function POST(request: Request, { params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  const body = await request.json().catch(() => null);
  return answer(() => postRevoke(vault, body, actionDeps(request)));
}
