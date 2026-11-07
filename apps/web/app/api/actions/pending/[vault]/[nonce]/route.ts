import { actionDeps, actionPreflight, answer } from "@/lib/actions-chain";
import { getPending } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const OPTIONS = actionPreflight;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vault: string; nonce: string }> }
) {
  const { vault, nonce } = await params;
  return answer(() => getPending(vault, nonce, actionDeps(request)));
}
