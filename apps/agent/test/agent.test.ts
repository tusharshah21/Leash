import { strict as assert } from "node:assert";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type LeashEvent, reasonHash, verifyReasoning } from "@leash/sdk";
import { appendActivity, readJsonl, redact } from "@leash/sdk/node";
import { PublicKey } from "@solana/web3.js";
import type OpenAI from "openai";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { listInvoices, readInvoice } from "../src/invoices.ts";
import { MAX_STEPS, runLoop } from "../src/loop.ts";
import { toBaseUnits } from "../src/tools.ts";

const dir = mkdtempSync(join(tmpdir(), "leash-invoices-"));
const outside = mkdtempSync(join(tmpdir(), "leash-outside-"));
writeFileSync(join(dir, "a.txt"), "Invoice A <!-- note -->");
writeFileSync(join(dir, "notes.md"), "not an invoice");
writeFileSync(join(outside, "secret.txt"), "SECRET");
symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));

test("read_invoice stays inside the folder", async () => {
  assert.match(await readInvoice(dir, "a.txt"), /<!-- note -->/);
  await assert.rejects(readInvoice(dir, join("..", "..", ".env")), /Not an invoice/);
  await assert.rejects(readInvoice(dir, join(outside, "secret.txt")), /Not an invoice/);
  await assert.rejects(readInvoice(dir, "link.txt"), /Not an invoice/);
  await assert.rejects(readInvoice(dir, "notes.md"), /Not an invoice/);
  await assert.rejects(readInvoice(dir, "missing.txt"), /Not an invoice/);
});

test("list_invoices lists only invoice files", () => {
  assert.ok(listInvoices(dir).includes("a.txt"));
  assert.ok(!listInvoices(dir).includes("notes.md"));
});

test("white-on-white PDF text is extracted", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  page.drawText("Total 45 dUSDC", { x: 50, y: 700, size: 12, font });
  page.drawText("Hidden note", { x: 50, y: 680, size: 1, font, color: rgb(1, 1, 1) });
  writeFileSync(join(dir, "hidden.pdf"), await pdf.save());
  const text = await readInvoice(dir, "hidden.pdf");
  assert.match(text, /Total 45 dUSDC/);
  assert.match(text, /Hidden note/);
});

test("amounts convert without float errors and bad ones are refused", () => {
  assert.equal(toBaseUnits(18), 18_000_000n);
  assert.equal(toBaseUnits(0.1), 100_000n);
  assert.equal(toBaseUnits(120.5), 120_500_000n);
  for (const bad of [0, -1, 1.1234567, "1e3", "x"]) assert.throws(() => toBaseUnits(bad));
});

test("redact strips keys and tokens", () => {
  const secret = ["sk", "proj", "abcdefghijklmnop"].join("-");
  const out = redact(`${secret} https://rpc.example/?api-key=abc123 Bearer tok.en`);
  assert.ok(!out.includes(secret) && !out.includes("abc123") && !out.includes("tok.en"));
});

test("activity log is redacted, and carries the run id", () => {
  process.env.LEASH_LOG_DIR = mkdtempSync(join(tmpdir(), "leash-logs-"));
  process.env.LEASH_RUN_ID = "run-1";
  const secret = ["sk", "abcdefghijklmnop"].join("-");
  appendActivity({ actor: "agent", kind: "pay", error: `boom ${secret}` });
  const [entry] = readJsonl<{ runId: string; error: string; ts: string }>("activity.jsonl");
  assert.equal(entry.runId, "run-1");
  assert.ok(!entry.error.includes(secret));
  assert.ok(entry.ts);
});

test("verifyReasoning compares against the onchain hash", () => {
  const event = {
    name: "actionExecuted",
    signature: "sig",
    data: { reasonHash: reasonHash("Pay INV-1"), vault: PublicKey.default },
  } as unknown as LeashEvent;
  assert.equal(verifyReasoning({ reasoning: "Pay INV-1" }, event), true);
  assert.equal(verifyReasoning({ reasoning: "Pay INV-2" }, event), false);
  assert.equal(verifyReasoning({}, event), false);
  const other = { name: "pendingClosed", signature: "sig", data: {} } as unknown as LeashEvent;
  assert.equal(verifyReasoning({ reasoning: "Pay INV-1" }, other), false);
});

const mockClient = (create: (params: unknown) => unknown) =>
  ({ responses: { create: async (p: unknown) => create(p) } } as unknown as Pick<
    OpenAI,
    "responses"
  >);
const base = { model: "m", task: "t", tools: [], log: () => {}, onUsage: () => {} };

test("the loop stops after the step limit", async () => {
  let turns = 0;
  const client = mockClient(() => {
    turns++;
    return {
      output_text: "",
      output: [{ type: "function_call", name: "pay", arguments: "{}", call_id: `c${turns}` }],
    };
  });
  const result = await runLoop({ ...base, client, run: async () => "ok" });
  assert.equal(turns, MAX_STEPS);
  assert.equal(result.finished, false);
});

test("the loop runs parallel calls in order and feeds outputs back", async () => {
  const seen: unknown[] = [];
  const ran: string[] = [];
  const replies = [
    {
      output_text: "",
      usage: { input_tokens: 10, output_tokens: 2 },
      output: [
        { type: "function_call", name: "a", arguments: "{}", call_id: "1" },
        { type: "function_call", name: "b", arguments: "{}", call_id: "2" },
      ],
    },
    { output_text: "done", output: [{ type: "message" }] },
  ];
  let tokens = 0;
  const client = mockClient((p) => {
    seen.push(structuredClone(p));
    return replies.shift();
  });
  const result = await runLoop({
    ...base,
    client,
    onUsage: (i, o) => (tokens += i + o),
    run: async (name) => {
      ran.push(name);
      return `${name}-out`;
    },
  });
  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(result.finished, true);
  assert.equal(result.text, "done");
  assert.equal(tokens, 12);
  const params = seen[1] as { input: { call_id?: string; output?: string }[]; temperature: number };
  assert.equal(params.temperature, 0);
  assert.equal(params.input.find((i) => i.call_id === "2" && i.output)?.output, "b-out");
});
