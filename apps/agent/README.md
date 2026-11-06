# apps/agent

The executor: an accounts payable assistant on OpenAI's Responses API, spending through a Leash vault. It holds only `keys/agent.json`. Its prompt has no injection defenses, on purpose: the demo shows that it can be fooled and the funds stay safe.

```bash
pnpm guard
```
```bash
pnpm agent "Pay this week's invoices in demo/invoices/. AP approved: Acme Design 18, CloudHost Inc 120 and 45, DataLabs 340 dUSDC."
```

| Tool | Does |
|---|---|
| `get_vault_status` | Balance, today's spending, limits, paused |
| `list_vendors` | The onchain allowlist |
| `list_invoices` | Invoice files in `LEASH_INVOICES_DIR`, default `demo/invoices` |
| `read_invoice` | Extracted text of one PDF or text invoice, untrusted. Refuses anything outside that folder |
| `pay` | The SDK's `act()`: LOW executes, MEDIUM asks the guard, HIGH proposes. `reason_hash` is `sha256(reasoning)` |

Temperature 0, at most 8 model turns. It acts on the vault from `LEASH_VAULT_OWNER`, else `demoVault` in `demo/devnet.json`, else the main demo vault. Each action goes to `logs/activity.jsonl`.

Tests are in `test/`, run with `pnpm test:apps`.
