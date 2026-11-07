// Live numbers for the landing page. Server-side and cached, so visitors do not spend RPC calls.
import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { NextResponse } from "next/server";
import { PROGRAM, RPC_URL } from "@/lib/chain";

export const dynamic = "force-dynamic";

const CACHE_MS = 60_000;
const SAMPLE = 1000;
// Program errors that mean a rule stopped an action, as opposed to a malformed request.
const BLOCKING = new Set([6000, 6001, 6003, 6005, 6006, 6007, 6010]);

let cached: { at: number; body: object } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) return NextResponse.json(cached.body);
  // The server's own RPC, like the Actions routes. The public endpoint can refuse
  // getProgramAccounts from cloud hosts, which left the landing page showing n/a.
  const connection = new Connection(process.env.LEASH_RPC_URL || RPC_URL, "confirmed");
  const program = new PublicKey(PROGRAM);
  const discriminator = createHash("sha256").update("account:Vault").digest().subarray(0, 8);
  const [vaults, signatures] = await Promise.allSettled([
    connection.getProgramAccounts(program, {
      dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(discriminator) } }],
    }),
    connection.getSignaturesForAddress(program, { limit: SAMPLE }),
  ]);
  if (vaults.status === "rejected" && signatures.status === "rejected") {
    return NextResponse.json({ error: "devnet is unreachable" }, { status: 502 });
  }
  // One number is better than none: the page shows n/a for whichever part failed.
  const sigs = signatures.status === "fulfilled" ? signatures.value : null;
  const body = {
    vaults: vaults.status === "fulfilled" ? vaults.value.length : undefined,
    blocked: sigs?.filter((s) => {
      const custom = (s.err as { InstructionError?: [number, { Custom?: number }] } | null)
        ?.InstructionError?.[1]?.Custom;
      return custom !== undefined && BLOCKING.has(custom);
    }).length,
    sampled: sigs?.length,
  };
  if (vaults.status === "fulfilled" && sigs) cached = { at: Date.now(), body };
  return NextResponse.json(body);
}
