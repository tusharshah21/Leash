// pnpm demo:faucet <wallet> <dUSDC> [--sol <amount>]. Devnet test tokens from the mint authority.
import { parseArgs } from "node:util";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { cliWallet, CONFIRMED, connection, demoKey, dusdc } from "./common.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { sol: { type: "string" } },
});
const [walletArg, amountArg] = positionals;
if (!walletArg || !amountArg) throw new Error("Usage: pnpm demo:faucet <wallet> <dUSDC> [--sol n]");
const wallet = new PublicKey(walletArg);
const payer = cliWallet();
const mint = demoKey("dusdc-mint").publicKey;

const account = await getOrCreateAssociatedTokenAccount(
  connection,
  payer,
  mint,
  wallet,
  false,
  "confirmed",
  CONFIRMED
);
await mintTo(
  connection,
  payer,
  mint,
  account.address,
  payer,
  dusdc(Number(amountArg)),
  [],
  CONFIRMED
);
if (values.sol) {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: wallet,
        lamports: Math.round(Number(values.sol) * LAMPORTS_PER_SOL),
      })
    ),
    [payer],
    CONFIRMED
  );
}
console.log(`Sent ${amountArg} dUSDC${values.sol ? ` and ${values.sol} SOL` : ""} to ${wallet}`);
process.exit(0);
