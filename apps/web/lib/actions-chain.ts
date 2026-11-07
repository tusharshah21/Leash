// Server only. The real data behind the Actions handlers, and how a route answers.
import { allowPda, LeashClient, mandatePda, pendingPda } from "@leash/sdk";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { ACTION_HEADERS, type ActionDeps, type ActionResult, type LoadedPending } from "./actions";
import { readActivity } from "./activity";
import { providerFor, readOnlyWallet, RPC_URL, VENDORS } from "./chain";

// LEASH_RPC_URL stays on the server, so these routes can use a key the browser never sees.
const connection = new Connection(process.env.LEASH_RPC_URL || RPC_URL, "confirmed");
const provider = providerFor(connection, readOnlyWallet);
const clientFor = (owner: PublicKey) => new LeashClient(provider, owner);
const anyClient = clientFor(PublicKey.default);

const LABEL_NUL = /\0+$/;

export const actionDeps = (request: Request): ActionDeps => ({
  site: (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, ""),
  clientFor,
  blockhash: async () => (await connection.getLatestBlockhash("confirmed")).blockhash,
  async loadVault(vault) {
    try {
      const v = await anyClient.program.account.vault.fetchNullable(vault);
      return (
        v && {
          owner: v.owner,
          device: v.device,
          mint: v.mint,
          paused: v.paused,
          pendingBase: BigInt(v.pendingBase.toString()),
        }
      );
    } catch (err) {
      // An address holding some other kind of account is not a vault.
      if (/discriminator/i.test(String((err as Error)?.message))) return null;
      throw err;
    }
  },
  async loadPending(vault, nonce) {
    const { program } = anyClient;
    const p = await program.account.pendingAction.fetchNullable(pendingPda(vault, nonce));
    if (!p) return null;
    const [mandate, entry, clock, activity] = await Promise.all([
      program.account.mandate.fetch(mandatePda(vault)),
      program.account.allowEntry.fetchNullable(allowPda(vault, p.recipient)),
      connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"),
      readActivity(vault.toBase58()),
    ]);
    if (!clock) throw new Error("Could not read the cluster clock");
    const recipient = p.recipient.toBase58();
    return {
      recipient: p.recipient,
      amount: BigInt(p.amount.toString()),
      status: Object.keys(p.status)[0] as LoadedPending["status"],
      createdAt: p.createdAt.toNumber(),
      ttlSecs: mandate.pendingTtlSecs.toNumber(),
      chainNow: Number(clock.data.readBigInt64LE(32)),
      label: entry
        ? Buffer.from(entry.label).toString("utf8").replace(LABEL_NUL, "")
        : VENDORS.find((v) => v.address === recipient)?.name,
      listed: !!entry,
      reasonHash: Array.from(p.reasonHash),
      activity,
    };
  },
});

export const actionPreflight = () => new Response(null, { status: 204, headers: ACTION_HEADERS });

/** Runs a handler. An RPC failure becomes the message shape the spec asks for. */
export async function answer(work: () => Promise<ActionResult>) {
  let result: ActionResult;
  try {
    result = await work();
  } catch (err) {
    console.error("action failed:", (err as Error)?.message?.replace(/api-key=[^\s&"]+/g, ""));
    result = { status: 500, body: { message: "Could not reach devnet. Try again in a moment." } };
  }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: ACTION_HEADERS,
  });
}
