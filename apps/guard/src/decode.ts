// Step one of the guard: never sign what you have not decoded. Pure, with no network, so every
// refusal here can be unit tested.
import { createHash } from "node:crypto";
import { allowPda, IDL } from "@leash/sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";

export interface DecodeContext {
  programId: PublicKey;
  vault: PublicKey;
  mandate: PublicKey;
  vaultToken: PublicKey;
  mint: PublicKey;
  agent: PublicKey;
  guard: PublicKey;
}

export interface Proposal {
  recipient: string;
  /** Base units, as a decimal string. */
  amount: string;
  memo: string;
  reasoning: string;
}

const EXECUTE = (
  IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }
).instructions.find((ix) => ix.name === "agent_execute")!;
const DISCRIMINATOR = Buffer.from(EXECUTE.discriminator);
const DATA_LENGTH = 8 + 8 + 32; // discriminator, amount, reason_hash
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;

function refuseUnless(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}

export const parseAmount = (amount: string) => {
  refuseUnless(/^[1-9][0-9]{0,19}$/.test(amount), "proposal amount is not a positive integer");
  return BigInt(amount);
};

/** Parses the transaction and returns it only if it does exactly what the proposal says. */
export function decodeAndVerify(
  serializedTx: string,
  proposal: Proposal,
  ctx: DecodeContext
): Transaction {
  const tx = Transaction.from(Buffer.from(serializedTx, "base64"));
  const recipient = new PublicKey(proposal.recipient);
  const amount = parseAmount(proposal.amount);

  const leash = [];
  for (const ix of tx.instructions) {
    if (ix.programId.equals(ctx.programId)) {
      leash.push(ix);
    } else {
      refuseUnless(ix.programId.equals(ComputeBudgetProgram.programId), "unexpected program");
      refuseUnless(
        ix.keys.length === 0 &&
          (ix.data[0] === SET_COMPUTE_UNIT_LIMIT || ix.data[0] === SET_COMPUTE_UNIT_PRICE),
        "disallowed compute budget instruction"
      );
    }
  }
  refuseUnless(leash.length === 1, "expected exactly one Leash instruction");
  const [ix] = leash;

  refuseUnless(ix.data.length === DATA_LENGTH, "instruction data has the wrong length");
  refuseUnless(ix.data.subarray(0, 8).equals(DISCRIMINATOR), "instruction is not agent_execute");
  refuseUnless(ix.data.readBigUInt64LE(8) === amount, "amount does not match the proposal");
  const hash = createHash("sha256").update(proposal.reasoning).digest();
  refuseUnless(ix.data.subarray(16).equals(hash), "reason hash does not match the reasoning");

  const expected: [string, PublicKey, boolean][] = [
    ["agent", ctx.agent, true],
    ["guard", ctx.guard, true],
    ["vault", ctx.vault, false],
    ["mandate", ctx.mandate, false],
    ["mint", ctx.mint, false],
    ["vault token account", ctx.vaultToken, false],
    ["recipient token account", getAssociatedTokenAddressSync(ctx.mint, recipient), false],
    ["allow entry", allowPda(ctx.vault, recipient), false],
    ["token program", TOKEN_PROGRAM_ID, false],
  ];
  refuseUnless(ix.keys.length === expected.length, "wrong number of accounts");
  expected.forEach(([name, key, signer], i) => {
    refuseUnless(ix.keys[i].pubkey.equals(key), `${name} does not match`);
    refuseUnless(ix.keys[i].isSigner === signer, `${name} has the wrong signer flag`);
  });

  // The guard must never pay fees or sign beside anyone but the agent.
  refuseUnless(tx.feePayer?.equals(ctx.agent) === true, "fee payer is not the agent");
  refuseUnless(tx.signatures.length === 2, "only the agent and guard may sign");
  const agentSig = tx.signatures.find((s) => s.publicKey.equals(ctx.agent));
  const guardSig = tx.signatures.find((s) => s.publicKey.equals(ctx.guard));
  refuseUnless(agentSig !== undefined && guardSig !== undefined, "only agent and guard may sign");
  refuseUnless(agentSig.signature !== null, "agent has not signed");
  refuseUnless(guardSig.signature === null, "guard signature slot is already filled");
  refuseUnless(tx.verifySignatures(false), "agent signature does not verify");

  return tx;
}
