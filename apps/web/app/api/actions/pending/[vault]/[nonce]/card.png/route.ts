import { PublicKey } from "@solana/web3.js";
import { actionCard, type CardProps } from "@/lib/action-card";
import { closedReason } from "@/lib/actions";
import { actionDeps } from "@/lib/actions-chain";
import { proposalContext } from "@/lib/timeline";

export const dynamic = "force-dynamic";

const NOTHING: CardProps = {
  banner: "NOTHING TO DECIDE",
  tone: "muted",
  headline: "Closed",
  lines: ["This proposal cannot move funds."],
};

async function props(request: Request, vaultParam: string, nonceParam: string): Promise<CardProps> {
  if (!/^\d{1,20}$/.test(nonceParam)) return NOTHING;
  const vault = new PublicKey(vaultParam);
  const nonce = BigInt(nonceParam);
  const deps = actionDeps(request);
  const loaded = await deps.loadVault(vault);
  if (!loaded || nonce < loaded.pendingBase) return NOTHING;
  const p = await deps.loadPending(vault, nonce, loaded);
  if (!p) return NOTHING;

  const address = p.recipient.toBase58();
  const risk = proposalContext(p.activity, nonceParam).review?.risk;
  const reason = closedReason(p);
  return {
    banner: reason
      ? reason.split(".")[0].toUpperCase()
      : p.listed
      ? "NEEDS YOUR APPROVAL"
      : "NOT ON ALLOWLIST",
    tone: reason ? "muted" : p.listed ? "pending" : "blocked",
    headline: (Number(p.amount) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }),
    unit: "dUSDC",
    lines: [
      `to ${p.label ?? "Unlisted address"}`,
      `${address.slice(0, 6)}...${address.slice(-6)}`,
      risk === undefined ? "No guard review" : `Guard risk ${risk} / 100`,
    ],
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vault: string; nonce: string }> }
) {
  const { vault, nonce } = await params;
  // An image request has nowhere to show an error, so anything wrong draws the neutral card.
  return actionCard(await props(request, vault, nonce).catch(() => NOTHING));
}
