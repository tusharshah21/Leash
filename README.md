# Leash

An onchain firewall for AI agents. Leash is a Solana program that enforces what an AI agent may do with funds, using three layers:

1. An owner-signed mandate: caps, a recipient allowlist, and an expiry.
2. A required guard-AI co-signature for medium-risk actions.
3. Onchain pending actions for high-risk actions, which only the owner or a hardware device key can approve.

Built for the MLH Solana Hackathon, November 2026. Contributor setup and commands are in [CLAUDE.md](CLAUDE.md).

## How the guard works

An AI executor reads invoices and can be fooled by what is in them. The guard is a separate service with its own key, and it never sees those documents. A medium-risk payment cannot land without its signature, and it signs only after these steps, in order. Any error means no signature.

1. **Decode the transaction.** It parses the bytes it was asked to sign and requires one `agent_execute` to the Leash program, plus compute budget instructions at most. Vault, recipient token account, amount and reason hash must match the proposal, and only the agent and guard may sign. A tampered amount, swapped recipient, extra instruction or wrong program is refused here, with no LLM involved.
2. **Check the rules.** The recipient is allowlisted onchain, the amount is within the mandate, the vault is not paused, and the same payment was not already approved in the last 24 hours, even under a new memo.
3. **Ask a judge.** A separate LLM call, with its own prompt, sees only the user's task, the structured proposal and the vendor list, never the invoice text. It answers one question: does this payment plausibly fulfil the task?
4. **Sign or refuse.** The decision is logged either way. A refusal returns 403 with the rationale.

Every payment's reasoning is hashed onchain as `reason_hash`, so anyone can check that a logged explanation is the one the transaction committed to.

```bash
pnpm demo:fresh
```
```bash
pnpm demo:run
```

The demo pays four invoices, one of them carrying a hidden instruction to also send 150 dUSDC to an attacker. The executor falls for it, and the money does not move: the unlisted recipient can only become a proposal that waits for a human, and a direct call is rejected onchain with `NotAllowlisted`. A second scenario points the injection at an allowlisted vendor with an inflated amount, where the chain alone would allow it. There, the guard denies it.

## Threat model

This is a draft.

**What Leash assumes will go wrong:** the executor gets fooled by a document, or its key is stolen. Neither should be able to move funds beyond what the owner signed.

| Attacker has | Can still | Cannot |
|---|---|---|
| A poisoned document | Make the executor pay an allowlisted vendor up to the LOW threshold per transaction, with no guard, until the daily cap | Pay an unlisted recipient without a human, or pass the guard with an amount the task did not approve |
| The agent key | The same, and propose anything, which costs it rent. It can also misstate the user's task to the judge | Exceed the mandate or skip the guard's signature on MEDIUM |
| The guard key, on its own | Nothing: the guard cannot initiate a payment | Move funds |
| The agent and guard keys together | Spend up to the mandate's limits, to allowlisted recipients | Pay unlisted recipients, exceed the caps, or approve a proposal |
| The owner or device key | Approve what is pending. The owner has full control | |

Known limits:

- **LOW payments skip the guard,** so the LOW threshold is the amount an injection can move per transaction to a listed vendor. Set it to what you can afford to lose repeatedly, under the daily cap.
- **The judge can be injected too.** The memo and reasoning it reads come from the possibly fooled executor. Its prompt treats them as claims and only the task as authority, but an LLM is not a hard boundary. The decode step and the chain are.
- **The judge is only as good as the task.** It can deny an inflated amount only if the task states what is approved.
- **The duplicate check has edges.** It never sees LOW payments. It refuses a second identical amount to a vendor under the same task, even if the task really wanted two. Across different tasks it keys on the memo, so a changed memo reaches the judge.
- **Separate keys on one machine are demo-level separation.** In production the guard belongs on its own host or in an enclave.

## Roadmap

- **Multiple mints per owner.** Today each owner has one vault and one mint (dUSDC), because vault seeds are `["vault", owner]`. The upgrade path is to add the mint to the seeds: `["vault", owner, mint]`.
- **`close_vault`.** Today a vault cannot be closed. Closing would return rent and free the owner's vault address.
