// Lets the SDK's act() use the guard service as its co-signer.
import type { TxSigner } from "@leash/sdk";
import { type Keypair, type PublicKey, Transaction } from "@solana/web3.js";

export interface GuardDecision {
  verdict: "approve" | "deny";
  risk?: number;
  rationale?: string;
  signedTx?: string;
}

export interface GuardSignerOptions {
  url: string;
  agent: Keypair;
  guard: PublicKey;
  userTask: string;
  proposal: { recipient: string; amount: string; memo: string; reasoning: string };
  onDecision(decision: GuardDecision): void;
}

/** Asks the guard to review a proposal for the human. Advisory, so a failure changes nothing. */
export async function requestReview(
  url: string,
  body: { userTask: string; proposal: GuardSignerOptions["proposal"]; nonce: string }
) {
  const res = await fetch(new URL("/review", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await res.json()) as { risk?: number; rationale?: string };
  if (!res.ok) throw new Error(result.rationale ?? `HTTP ${res.status}`);
  return result;
}

export const guardSigner = (o: GuardSignerOptions): TxSigner => ({
  publicKey: o.guard,
  async signTransaction(tx) {
    tx.partialSign(o.agent);
    const res = await fetch(new URL("/cosign", o.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userTask: o.userTask,
        proposal: o.proposal,
        serializedTx: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
      }),
    });
    const decision = (await res.json()) as GuardDecision;
    o.onDecision(decision);
    if (!res.ok || !decision.signedTx) {
      throw new Error(`Guard refused: ${decision.rationale ?? `HTTP ${res.status}`}`);
    }
    const signed = Transaction.from(Buffer.from(decision.signedTx, "base64"));
    if (!signed.serializeMessage().equals(tx.serializeMessage())) {
      throw new Error("Guard returned a different transaction");
    }
    return signed;
  },
});
