// The executor's tools. `pay` goes through the SDK's act(), so the mandate picks the tier.
import {
  describeError,
  type LeashClient,
  LeashTxError,
  reasonHash,
  type TxSigner,
} from "@leash/sdk";
import { appendActivity } from "@leash/sdk/node";
import { getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { GuardDecision } from "./guard-client.ts";
import { listInvoices, readInvoice } from "./invoices.ts";

const DECIMALS = 6;
const toDusdc = (base: { toString(): string }) => Number(base.toString()) / 10 ** DECIMALS;
const hex = (bytes: number[]) => Buffer.from(bytes).toString("hex");
const txLink = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

/** dUSDC as the model sends it, to base units, without going through float arithmetic. */
export function toBaseUnits(amount: number | string): bigint {
  const text = String(amount);
  const match = text.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) throw new Error(`Invalid amount: ${text}`);
  const base = BigInt(match[1]) * 10n ** 6n + BigInt((match[2] ?? "").padEnd(DECIMALS, "0") || 0);
  if (base <= 0n) throw new Error("Amount must be above zero");
  return base;
}

export const definitions = [
  {
    name: "get_vault_status",
    description:
      "The vault's dUSDC balance, today's spending, its limits, and whether it is paused.",
    properties: {},
  },
  {
    name: "list_vendors",
    description: "The approved vendors, with their names and payment addresses.",
    properties: {},
  },
  {
    name: "list_invoices",
    description: "The invoice files waiting to be processed.",
    properties: {},
  },
  {
    name: "read_invoice",
    description: "The full extracted text of one invoice file, from a PDF or text file.",
    properties: { path: { type: "string", description: "A file name from list_invoices" } },
  },
  {
    name: "pay",
    description:
      "Pays a recipient from the vault. Small payments go straight through, larger ones need the guard's co-signature, and the largest wait for a human.",
    properties: {
      recipient: { type: "string", description: "The recipient's payment address" },
      amount: { type: "number", description: "The amount in dUSDC" },
      memo: { type: "string", description: "A short memo, such as the invoice number" },
      reasoning: { type: "string", description: "Why you are making this payment" },
    },
  },
].map(({ properties, ...rest }) => ({
  type: "function" as const,
  ...rest,
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  },
}));

export interface ToolDeps {
  client: LeashClient;
  invoicesDir: string;
  makeGuard(
    proposal: { recipient: string; amount: string; memo: string; reasoning: string },
    onDecision: (decision: GuardDecision) => void
  ): TxSigner;
  /** Optional, advisory guard review of a proposal. */
  review?(
    proposal: { recipient: string; amount: string; memo: string; reasoning: string },
    nonce: string
  ): Promise<{ risk?: number; rationale?: string }>;
  log(line: string): void;
}

export function makeTools({ client, invoicesDir, makeGuard, review, log }: ToolDeps) {
  async function pay(a: { recipient: string; amount: number; memo: string; reasoning: string }) {
    const amount = toBaseUnits(a.amount);
    const recipient = new PublicKey(a.recipient);
    const proposal = {
      recipient: a.recipient,
      amount: amount.toString(),
      memo: a.memo,
      reasoning: a.reasoning,
    };
    const entry = {
      actor: "agent" as const,
      kind: "pay",
      vault: client.vault.toBase58(),
      ...proposal,
      reasonHash: hex(reasonHash(a.reasoning)),
    };
    let decision: GuardDecision | undefined;
    const fromGuard = () =>
      decision && { verdict: decision.verdict, risk: decision.risk, rationale: decision.rationale };
    try {
      const result = await client.act(amount, recipient, a.reasoning, {
        guard: makeGuard(proposal, (d) => (decision = d)),
      });
      const nonce = result.tier === "HIGH" ? result.nonce.toString() : undefined;
      appendActivity({
        ...entry,
        ...fromGuard(),
        tier: result.tier,
        txSig: result.signature,
        nonce,
      });
      const status = result.tier === "HIGH" ? "pending human approval" : "paid";
      log(`  ${result.tier}: ${status}. ${txLink(result.signature)}`);
      if (nonce && review) {
        await review(proposal, nonce).then(
          (r) => log(`  Guard review, risk ${r.risk ?? "-"}: ${r.rationale ?? ""}`),
          (err) => log(`  Guard review unavailable: ${describeError(err)}`)
        );
      }
      return { status, tier: result.tier, signature: result.signature };
    } catch (err) {
      const error = describeError(err);
      const signature = err instanceof LeashTxError ? err.signature : undefined;
      appendActivity({
        ...entry,
        ...fromGuard(),
        tier: decision ? "MEDIUM" : undefined,
        txSig: signature,
        error,
      });
      log(`  Refused: ${error}`);
      return { status: "refused", error };
    }
  }

  const tools: Record<string, (args: never) => Promise<unknown>> = {
    async get_vault_status() {
      const [vault, mandate, balance] = await Promise.all([
        client.fetchVault(),
        client.fetchMandate(),
        getAccount(client.provider.connection, client.vaultToken, "confirmed"),
      ]);
      return {
        balance: toDusdc(balance.amount),
        spentToday: toDusdc(mandate.spentToday),
        lowThreshold: toDusdc(mandate.lowThreshold),
        perTxMax: toDusdc(mandate.perTxMax),
        dailyCap: toDusdc(mandate.dailyCap),
        paused: vault.paused,
      };
    },
    async list_vendors() {
      return (await client.fetchAllowlist()).map((v) => ({
        name: v.label,
        address: v.recipient.toBase58(),
      }));
    },
    list_invoices: async () => listInvoices(invoicesDir),
    read_invoice: async (a: { path: string }) => readInvoice(invoicesDir, a.path),
    pay,
  };

  /** Runs one tool. Errors go back to the model as text. */
  return async function run(name: string, args: string): Promise<string> {
    try {
      const tool = tools[name];
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      const result = await tool(JSON.parse(args) as never);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      const error = describeError(err);
      log(`  Tool error: ${error}`);
      return JSON.stringify({ error });
    }
  };
}
