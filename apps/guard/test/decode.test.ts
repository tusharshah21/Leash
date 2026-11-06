import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { allowPda, IDL, mandatePda, PROGRAM_ID, vaultPda, vaultTokenPda } from "@leash/sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { type DecodeContext, decodeAndVerify, type Proposal } from "../src/decode.ts";

const agent = Keypair.generate();
const guard = Keypair.generate();
const owner = Keypair.generate().publicKey;
const vault = vaultPda(owner);
const mint = Keypair.generate().publicKey;
const vendor = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();

const ctx: DecodeContext = {
  programId: PROGRAM_ID,
  vault,
  mandate: mandatePda(vault),
  vaultToken: vaultTokenPda(vault),
  mint,
  agent: agent.publicKey,
  guard: guard.publicKey,
};

const proposal: Proposal = {
  recipient: vendor.toBase58(),
  amount: "120000000",
  memo: "INV-1",
  reasoning: "Invoice INV-1 from CloudHost",
};

const discriminator = Buffer.from(
  (
    IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }
  ).instructions.find((i) => i.name === "agent_execute")!.discriminator
);

interface Overrides {
  amount?: bigint;
  reasoning?: string;
  recipient?: PublicKey;
  vault?: PublicKey;
  guard?: PublicKey;
  programId?: PublicKey;
  trailing?: Buffer;
}

function executeIx(o: Overrides = {}) {
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(o.amount ?? 120_000_000n);
  const hash = createHash("sha256")
    .update(o.reasoning ?? proposal.reasoning)
    .digest();
  const recipient = o.recipient ?? vendor;
  const signer = (pubkey: PublicKey) => ({ pubkey, isSigner: true, isWritable: false });
  const plain = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
  return new TransactionInstruction({
    programId: o.programId ?? PROGRAM_ID,
    data: Buffer.concat([discriminator, amount, hash, o.trailing ?? Buffer.alloc(0)]),
    keys: [
      signer(agent.publicKey),
      signer(o.guard ?? guard.publicKey),
      plain(o.vault ?? vault),
      plain(ctx.mandate),
      plain(mint),
      plain(ctx.vaultToken),
      plain(getAssociatedTokenAddressSync(mint, recipient)),
      plain(allowPda(vault, recipient)),
      plain(TOKEN_PROGRAM_ID),
    ],
  });
}

function build(ixs: TransactionInstruction[], payer = agent, signers = [agent]) {
  const tx = new Transaction();
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);
  if (signers.length > 0) tx.partialSign(...signers);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

const refused = (tx: string, pattern: RegExp, p = proposal) =>
  assert.throws(() => decodeAndVerify(tx, p, ctx), pattern);

test("accepts the transaction the proposal describes, and the guard can sign it", () => {
  const tx = decodeAndVerify(build([executeIx()]), proposal, ctx);
  tx.partialSign(guard);
  assert.ok(tx.verifySignatures(true));
});

test("accepts compute budget limit and price instructions", () => {
  const budget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];
  decodeAndVerify(build([...budget, executeIx()]), proposal, ctx);
});

test("refuses a tampered amount", () => {
  refused(build([executeIx({ amount: 190_000_000n })]), /amount does not match/);
});

test("refuses a swapped recipient", () => {
  const attacker = Keypair.generate().publicKey;
  refused(build([executeIx({ recipient: attacker })]), /recipient token account does not match/);
});

test("refuses an extra instruction", () => {
  const drain = SystemProgram.transfer({
    fromPubkey: agent.publicKey,
    toPubkey: vendor,
    lamports: 1,
  });
  refused(build([executeIx(), drain]), /unexpected program/);
  refused(build([executeIx(), executeIx()]), /exactly one Leash/);
});

test("refuses the wrong program", () => {
  refused(build([executeIx({ programId: Keypair.generate().publicKey })]), /unexpected program/);
});

test("refuses another vault", () => {
  refused(build([executeIx({ vault: Keypair.generate().publicKey })]), /vault does not match/);
});

test("refuses a different guard key", () => {
  refused(build([executeIx({ guard: Keypair.generate().publicKey })]), /guard does not match/);
});

test("refuses the guard as fee payer", () => {
  refused(build([executeIx()], guard, []), /fee payer/);
});

test("refuses a missing or bad agent signature", () => {
  refused(build([executeIx()], agent, []), /agent has not signed/);
  const raw = Transaction.from(Buffer.from(build([executeIx()]), "base64"));
  const forged = Keypair.generate();
  const other = new Transaction();
  other.feePayer = agent.publicKey;
  other.recentBlockhash = forged.publicKey.toBase58();
  other.add(executeIx());
  other.partialSign(agent);
  raw.signatures[0].signature = other.signatures[0].signature;
  const tampered = raw
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  refused(tampered, /does not verify/);
});

test("refuses trailing bytes in the instruction data", () => {
  refused(build([executeIx({ trailing: Buffer.from([1]) })]), /wrong length/);
});

test("refuses a reason hash that does not match the reasoning", () => {
  refused(build([executeIx({ reasoning: "something else" })]), /reason hash/);
});

test("refuses a disallowed compute budget instruction", () => {
  const heap = ComputeBudgetProgram.requestHeapFrame({ bytes: 32 * 1024 });
  refused(build([heap, executeIx()]), /disallowed compute budget/);
});

test("refuses a guard signature slot that is already filled", () => {
  refused(build([executeIx()], agent, [agent, guard]), /already filled/);
});

test("refuses a bad proposal amount and garbage bytes", () => {
  refused(build([executeIx()]), /not a positive integer/, { ...proposal, amount: "-1" });
  refused(build([executeIx()]), /not a positive integer/, { ...proposal, amount: "1.5" });
  assert.throws(() => decodeAndVerify("not a transaction", proposal, ctx));
});
