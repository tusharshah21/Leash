import { actionDeps, actionPreflight, answer } from "@/lib/actions-chain";
import { postDecision } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const OPTIONS = actionPreflight;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ vault: string; nonce: string }> }
) {
  const { vault, nonce } = await params;
  const body = await request.json().catch(() => null);
  return answer(() => postDecision("reject", vault, nonce, body, actionDeps(request)));
}
