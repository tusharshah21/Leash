# Leash

Onchain firewall for AI agents, built for the MLH Solana Hackathon (Nov 6-8, 2026). A Solana program enforces what an agent may do with funds through three layers: an owner-signed mandate (caps, allowlist, expiry), a required guard-AI co-signature for medium-risk actions, and onchain PendingActions for high-risk actions that only the owner or a hardware device key can approve.

## Architecture

| Path | Status | Purpose |
|---|---|---|
| `programs/leash` | Phase 3, deployed | The Anchor program |
| `tests/` | Phase 3 | Mocha tests against a local validator: `helpers.ts` (shared), `leash.ts` (owner paths), `attacks.ts` (tier routing, attacks, approvals) |
| `packages/sdk` | Phase 4 | The shared client: `LeashClient`, events, error messages, `classifyTier`, `verifyReasoning`. `@leash/sdk/node` adds logging and key loading. See its README |
| `scripts` | Phase 5 | `deploy-devnet.sh`, `bootstrap-devnet.ts`, `smoke-devnet.ts`, `setup-vault.ts`, `gen-invoices.ts`, `demo-fresh.ts`, `demo-run.ts`, `demo-faucet.ts`, `demo-snapshot.ts` |
| `apps/agent` | Phase 4 | The executor: OpenAI tool loop, reads untrusted invoices, holds only the agent key |
| `apps/guard` | Phase 4 | The guard: localhost HTTP service, decodes before signing, holds only the guard key |
| `apps/web` | Phase 5 | The console: landing, `/console/[vault]`, `/create`. Pure merge logic in `lib/timeline.ts`. See its README |
| `apps/mcp` | Stub | MCP server |
| `device/unoq` | Stub | Hardware device key firmware |
| `demo` | Phase 4 | `devnet.json` (public addresses), `invoices/` and `scenarios/` (what the agent reads, and the expected outcomes) |

### The AI layer

Two processes with separate keys. The agent reads untrusted documents and can be fooled, on purpose: its prompt has no injection defenses. `pay` calls the SDK's `act()`, so the mandate picks the tier: LOW executes, MEDIUM posts to the guard, HIGH proposes.

The guard's `POST /cosign` takes `{ userTask, proposal: { recipient, amount, memo, reasoning }, serializedTx }`, with `amount` in base units. Its pipeline runs in this order, and any error refuses without a signature:

1. **Decode** (`decode.ts`, pure). Only one Leash `agent_execute` plus `SetComputeUnitLimit` or `SetComputeUnitPrice`. All 9 accounts as expected, with the recipient token account as the proposal recipient's ATA. Data exactly 48 bytes, amount equal to the proposal, reason hash equal to `sha256(reasoning)`. Fee payer is the agent, the only signers are the agent and guard, and the agent's signature verifies.
2. **Rules** (`rules.ts`). Not paused, mandate unexpired, recipient allowlisted, tier not HIGH, and not a duplicate approved for this vault in the last 24 hours, from `logs/guard.jsonl`: same recipient and amount, with the same normalized memo or under the same task.
3. **Judge** (`judge.ts`). A separate OpenAI call with its own prompt and a strict schema, `{ verdict, risk, rationale }`. Input is only `userTask`, the proposal and the onchain vendor list, never the invoice.
4. **Sign.** The decision is logged first, so nothing is signed unlogged.

`POST /review` takes `{ userTask, proposal, nonce }` after a HIGH proposal. It checks the proposal against the onchain PendingAction, runs the rules and the judge, and logs `{ nonce, risk, rationale, findings }` for the pending card. It is advisory: it has no signing path and does not count toward duplicates, and a failed review never affects the proposal.

Logs are gitignored and redacted: `logs/guard.jsonl` (every decision) and `logs/activity.jsonl` (agent and guard, one entry per action, the source for the Phase 5 "verified reasoning" badge through `verifyReasoning`).

### Threat notes

- The chain is the only hard limit. The guard and judge add judgement inside the mandate, and a compromised guard can only approve what the mandate already allows as MEDIUM.
- LOW skips the guard, so an injection can still move up to `low_threshold` per transaction to an allowlisted vendor, until `daily_cap`.
- `memo` and `reasoning` come from the possibly fooled agent, so they are an injection channel into the judge. The prompt treats them as claims and only the task as authority, and lengths are capped.
- `userTask` also arrives through the agent. It is trusted here because the executor gets it from the operator and never rewrites it, but a stolen agent key could lie about it. The fix is for the guard to take the task from the operator directly.
- The duplicate rule cannot see LOW payments, because they skip the guard. Across different tasks it keys on the memo, so a changed memo reaches the judge.
- Separate keys in separate processes on one machine is demo-level separation. Production needs separate hosts or an enclave.

### Devnet deployment

| Item | Value |
|---|---|
| Program ID | `8XkDgSyKTDfg7WGP8RGS4bgqN4L2XjMQmEnG4gUCCu2C` |
| Upgrade authority | `2pJ8gVQmeTdyh2Ewz5H6zn4Z13J9fQkRheHiNi2pHFD8` (the CLI wallet) |
| Deploy tx | `52PX6n6mQvYEgWXqezbdFdyJ8WoG4fPpDMZCov6RY3kZTFEr1AonhQiueudV1rgV7db273e2DU46Rqiz9bkMgcsM` |
| IDL | Onchain through the program metadata program, account `FdBCrdS4bsDgZ7Ad9K3QWdNyHZt2dqKNZExHqQuBf13w` |
| Size | 326,456 bytes, with no spare capacity. A bigger build needs `solana program extend` first |

An upgrade temporarily ties up about 1.66 SOL for its buffer, refunded when it finishes, so top up the CLI wallet from `browserWallet` first. After an upgrade that changes the interface, run `pnpm build:sdk`.

The demo vault's secret keys live in `keys/`, which is gitignored. A run of `pnpm smoke:devnet` uses 28 dUSDC of the vault's 500 daily cap until the window resets.

### Program accounts

| Account | Seeds | Holds |
|---|---|---|
| Vault | `["vault", owner]` | owner, agent, guard, device, mint, token account, paused, pending_nonce |
| Vault token account | `["vault_token", vault]` | The funds. Authority is the vault PDA |
| Mandate | `["mandate", vault]` | low_threshold, per_tx_max, daily_cap, spent_today, window_start, expires_at, window_secs, pending_ttl_secs |
| AllowEntry | `["allow", vault, recipient]` | recipient, label, per_recipient_cap |
| PendingAction | `["pending", vault, nonce_le_bytes]` | vault, recipient, amount, reason_hash, status, created_at |

### Instructions

| Signer | Instructions |
|---|---|
| Owner | `init_vault`, `set_mandate`, `add_recipient`, `remove_recipient`, `deposit`, `withdraw`, `unpause`, `rotate_keys`, `close_pending` |
| Owner or device | `revoke_agent`, `approve_pending`, `reject_pending` |
| Agent | `agent_execute` (plus the guard for MEDIUM), `agent_propose` |

### Tier rules

`Mandate::route` in `state.rs` is the source of truth, and `classifyTier` in `packages/sdk/src/tier.ts` mirrors it. Change both together. `agent_execute` checks in this order, and the first failure wins:

1. `VaultPaused`
2. `Unauthorized`: signer is not `vault.agent`
3. `MandateExpired`
4. Reset the window if `now >= window_start + window_secs`
5. `InvalidAmount`: amount is zero
6. `NotAllowlisted`: recipient has no allow entry
7. `RequiresApproval`: amount is over `per_tx_max` or `per_recipient_cap`
8. `ExceedsDailyCap`: `spent_today + amount` is over `daily_cap`
9. `GuardSignatureRequired`: tier is MEDIUM without the real guard's signature

| Tier | Rule | Path |
|---|---|---|
| LOW | Passes all of the above, amount <= `low_threshold` | `agent_execute`, agent signature alone |
| MEDIUM | Passes all of the above, amount > `low_threshold` | `agent_execute`, agent plus guard |
| HIGH | Fails step 6, 7 or 8 | `agent_propose`, then a human runs `approve_pending` |

### Errors

| Code | Name | Raised when |
|---|---|---|
| 6000 | `Unauthorized` | Signer lacks the role for this action |
| 6001 | `VaultPaused` | Agent acts on a paused vault |
| 6002 | `VaultNotPaused` | Agent key rotated without pausing first |
| 6003 | `MandateExpired` | Agent acts at or after `expires_at` |
| 6004 | `InvalidMandate` | Thresholds out of order, expiry in the past, or a duration below 60 seconds |
| 6005 | `NotAllowlisted` | `agent_execute` to a recipient with no allow entry |
| 6006 | `ExceedsDailyCap` | `agent_execute` would pass `daily_cap` |
| 6007 | `GuardSignatureRequired` | MEDIUM with no guard or the wrong guard |
| 6008 | `InvalidAmount` | Amount is zero |
| 6009 | `KeyReuseNotAllowed` | Agent, guard and device not distinct, or agent or guard equals owner |
| 6010 | `RequiresApproval` | `agent_execute` over `per_tx_max` or `per_recipient_cap` |
| 6011 | `PendingExpired` | Approve after `created_at + pending_ttl_secs` |
| 6012 | `PendingNotActive` | Approve or reject when status is not `Pending` |
| 6013 | `RecipientMismatch` | Approve to a token account with the wrong owner or mint |
| 6014 | `MathOverflow` | Checked arithmetic overflowed |
| 6015 | `PendingStillActive` | Close while status is still `Pending` |

### Compute units

Measured from the tx logs on the local validator; `anchor test` prints them. `agent_execute` varies with the recipient, because it derives the `allow_entry` PDA with `find_program_address`, and each extra bump attempt appears to cost about 1,500 CU. `approve_pending` uses stored bumps.

| Instruction | CU seen across two runs |
|---|---|
| `agent_execute` (LOW) | 14,514 and 14,514 |
| `agent_execute` (MEDIUM) | 17,538 and 16,038 |
| `approve_pending` | 16,412 and 16,412 |

## Pinned versions

Never upgrade these. The pair of Anchor 1.2.2 and Solana 4.1.2 comes from the Anchor 1.2.2 release notes; Agave's `stable` channel is newer and is deliberately not used.

| Tool | Version | Pinned in |
|---|---|---|
| Anchor CLI, `anchor-lang`, `anchor-spl`, `@anchor-lang/core` | 1.2.2 | `Anchor.toml`, `programs/leash/Cargo.toml`, `package.json` |
| Solana CLI (Agave) | 4.1.2, platform-tools v1.57 | `Anchor.toml` |
| Rust (host) | 1.96.0 | `rust-toolchain.toml` |
| Node | 22.22.3 | `.nvmrc`, `package.json` |
| pnpm | 10.33.0 | `package.json` |

## Environment

Windows host, WSL distro `Ubuntu-24.04`, user `tushar`, repo at `/home/tushar/projects/leash`. WSL's default distro is `docker-desktop`, so a bare `wsl` does not open Ubuntu: use `wsl -d Ubuntu-24.04 -u tushar`. Build on the Linux filesystem, not `/mnt/c`.

`~/.bashrc` sets `ANCHOR_TEST_VALIDATOR=legacy` (Anchor 1.x otherwise runs tests on Surfpool) and `CARGO_BUILD_JOBS=2` (the laptop has limited RAM).

- browserWallet: `J2nBcSoqjH662JZ5U2uTVb1QuaDir8e6kkKaswrtEukq` (devnet, Phantom)
- LLM provider: OpenAI

## Commands

```bash
anchor build
```
```bash
anchor test
```
```bash
pnpm test:fast
```
```bash
pnpm test:all
```
```bash
pnpm test:sdk
```
```bash
cargo clippy --all-targets -- -D warnings
```
```bash
anchor keys sync
```
```bash
pnpm build:sdk
```
```bash
pnpm deploy:devnet
```
```bash
pnpm bootstrap:devnet
```
```bash
pnpm smoke:devnet
```
```bash
pnpm test:apps
```
```bash
pnpm typecheck
```
```bash
pnpm guard
```
```bash
pnpm agent "Pay this week's invoices in demo/invoices/. AP approved: Acme Design 18, CloudHost Inc 120 and 45, DataLabs 340 dUSDC."
```
```bash
pnpm demo:fresh
```
```bash
pnpm demo:run
```
```bash
RUN_LLM=1 pnpm test:apps
```
```bash
pnpm dev:web
```
```bash
pnpm --filter web build
```
```bash
pnpm demo:run --vault <vault>
```
```bash
pnpm agent --vault <vault> "<task>"
```
```bash
pnpm demo:faucet <wallet> <dUSDC> --sol <n>
```
```bash
pnpm demo:snapshot --vault <vault>
```

The apps run on Node's native TypeScript with `.ts` imports and no build step, but they import the SDK's `dist/`, so run `pnpm build:sdk` first. `pnpm test:apps` needs no network or LLM unless `RUN_LLM=1`. `pnpm demo:fresh` costs about 0.0135 SOL from the CLI wallet. `pnpm demo:run` exits non-zero if the outcome differs from `demo/scenarios/*.json`.

The devnet commands read `LEASH_RPC_URL` from `.env` (see `.env.example`) and fall back to the public endpoint, which logs 429 retries but works. Run `pnpm build:sdk` before the bootstrap and smoke scripts: `dist/` is gitignored. `pnpm deploy:devnet` stops before sending anything if the program ID does not match or the balance is short; `CHECK_ONLY=1` stops it after those checks.

`pnpm test:fast` (plain `anchor test`) takes about 70 seconds and skips the two tests that wait out the 60-second minimum durations. `pnpm test:all` sets `RUN_SLOW=1` to include them and takes about 3 minutes. Both also run the SDK tests and stop the validator when they finish. `pnpm test:sdk` runs alone in under a second.

The program keypair is `target/deploy/leash-keypair.json`, which is gitignored. Back it up: deleting `target/` without a copy changes the program ID.

## Coding conventions

- All token amounts are `u64`. All arithmetic is checked.
- Size accounts with `InitSpace`. Seeds live in `constants.rs`.
- One file per instruction in `programs/leash/src/instructions/`, each exposing `handle_<name>`.
- Owner checks use `has_one = owner @ LeashError::Unauthorized` with seeds derived from `vault.owner`, so a wrong signer on a real vault fails with `Unauthorized`.
- Every state change emits an event from `events.rs`.
- No `unwrap()`, `expect()` or `panic!` in program code. Clippy passes with `-D warnings`.
- Negative tests are named as attacks and assert the exact error code. Fund-touching tests also assert balances.
- Tests use the helpers in `tests/helpers.ts`, which carry the commitment fixes from Decision 12. Wait on the cluster's clock with `waitForClock`, not a fixed sleep.
- Keep secrets out of git: `.env*` and keypair JSON files are ignored. Check `git ls-files` before committing.
- Prose: no em dashes, and no hard-wrapped Markdown paragraphs.
- Commits: conventional style, no AI attribution.
- Pushing: Claude may push to this repo's `origin` (`tusharshah21/Leash`) when asked, by the developer's explicit grant for this project only. Never force push. WSL has no GitHub credentials of its own, so pass Git Credential Manager from Windows for the push: `git -c credential.helper= -c "credential.helper=/mnt/c/Users/tushar.kumar/AppData/Local/Programs/Git/mingw64/bin/git-credential-manager.exe" push`.

## Decisions

Newest last.

1. **Anchor 1.2.2 with Solana 4.1.2.** Latest stable Anchor and its recommended Solana version.
2. **Local validator, not Surfpool.** `anchor test` uses `solana-test-validator` through `ANCHOR_TEST_VALIDATOR=legacy`.
3. **Vault token account is a PDA, not an ATA.** Anyone can create an ATA for a known vault address in advance, which would make `init` fail and block that owner's vault for good. A program-derived token account cannot be front-run this way.
4. **Classic SPL Token only.** Token-2022 extensions such as transfer hooks and fees would complicate the caps.
5. **`AllowEntry.recipient` is a wallet.** Phase 2 checks the destination token account's `owner` and `mint` at execution time.
6. **`per_recipient_cap` is a per-transaction cap.** `AllowEntry` has no spent counter, so a cumulative cap would need a new field.
7. **Known limitation: one vault, and so one mint, per owner.** Seeds stay `["vault", owner]`, and a single mint (dUSDC) is enough for the hackathon. Upgrade path for the README roadmap: add the mint to the seeds, `["vault", owner, mint]`, which requires a redeploy.
8. **No `close_vault` for now.** Noted in the README roadmap.
9. **`rotate_keys` added in Phase 1.** Without it, `unpause` would revive a leaked agent key and the owner could not create a replacement vault. Rotating the agent requires the vault to be paused first.
10. **`withdraw` works while paused,** so the owner can always pull funds during an incident.
11. **`rotate_keys` takes `new_device: Option<Option<Pubkey>>`, and Anchor's TS coder cannot encode `Some(None)`.** It encodes `null` as the outer `None`, so removing the device key from TypeScript requires patching the instruction data: replace the trailing `0x00` with `0x01 0x00`. `patchClearDevice` in `packages/sdk/src/tier.ts` does this.
12. **Tests wait for `confirmed` everywhere, setup included.** Options passed to `.rpc()` replace the provider defaults rather than merging, so `preflightCommitment` must be set alongside `commitment`, or preflight fails with `Blockhash not found`. Setup that only reaches `processed` races the next `confirmed` preflight and fails with `AccountNotInitialized`.
13. **`anchor-spl` keeps its default features.** The `Accounts` derive references `token_2022` and `token_interface` even for classic SPL Token, so trimming features breaks the build.

14. **Key separation.** Agent, guard and device (if set) must be pairwise distinct, and agent and guard must differ from the owner, in `init_vault` and `rotate_keys`. Otherwise one key could satisfy two layers. `device == owner` is allowed. `rotate_keys` validates the resulting key set, so a rotation cannot collide with a key it left unchanged.
15. **HIGH actions report why they failed.** `classifyTier` returns HIGH for all of them, but `agent_execute` returns `NotAllowlisted`, `ExceedsDailyCap` or `RequiresApproval`, so the agent and a demo can see the reason. All three mean the same thing to a client: use `agent_propose`. `ExceedsPerTxMax` was removed as unused.
16. **`allow_entry` in `agent_execute` is an `UncheckedAccount`,** read by hand only when the program owns it. An `Account` would fail on a missing entry during deserialization, before the ordered checks, so `NotAllowlisted` would never appear. The seeds use `recipient_token_account.owner`, so one recipient's entry cannot cover another's token account.
17. **`agent_propose` accepts anything,** including amounts that would be LOW or MEDIUM and recipients not on the allowlist: the agent may always escalate, and a proposal moves no funds until a human approves it. The agent pays the rent.
18. **`pending_ttl_secs` makes pending expiry testable.** The default is 24 hours and the minimum 60 seconds. The legacy validator has no clock control, so `expired_pending_cannot_be_approved` sets the minimum and waits it out. The value is read at approval time, so the owner can extend or shorten it for outstanding proposals, including reviving an expired one; the owner has that authority anyway.
19. **Human approval may exceed `daily_cap`,** because a human chose to. `spent_today` uses `saturating_add`, and stays over the cap, so agent spending is blocked until the window resets.
20. **Human authority survives a pause and an expired mandate.** `approve_pending` and `reject_pending` check neither. Only approve respects the TTL: an expired action can never move funds, but it can still be rejected, so stale proposals can be cleaned up.
21. **`approve_pending` rolls an elapsed window first,** so the spend counts against the current window and not one that has ended.
22. **`window_secs` and `pending_ttl_secs` came out of `_reserved`.** A compile-time assert pins `Mandate::INIT_SPACE` at 113. The window is fixed rather than sliding: it restarts on the first agent action or approval after it ends.
23. **The four action events carry a `vault` field,** like every other event, so a dashboard can attribute them.
24. **`close_pending` sends rent to the owner, not the agent that paid it.** `PendingAction` stores no payer and has no `_reserved`, and a refund to the payer would hand SOL to a leaked agent key. The owner funds the agent anyway. Only `Executed` and `Rejected` actions can close; an expired one must be rejected first. The audit trail survives in the transaction history and the `PendingClosed` event.
25. **The test validator runs 50 ms slots (`ticks_per_slot = 8`),** which cut the fast suite from about 5 minutes to about 70 seconds. It requires two settings in `tests/helpers.ts`: web3.js's 30-second blockhash cache must be off, because 30 seconds is now past a blockhash's 150-slot lifetime, and the connection must use `confirmed`, because a fresh `processed` blockhash is ahead of the bank preflight simulates against. Both surface as `Blockhash not found`.
26. **The SDK takes Anchor's exports through `packages/sdk/src/anchor.ts`.** `@anchor-lang/core` has no `exports` map, so Node loads its CommonJS build and cannot see named exports from ESM, while bundlers load its ESM build, which has no default. Scripts use the default import, since they only run in Node.
27. **SDK events decode with `program.coder`, not the raw IDL.** The raw IDL gives PascalCase event names and snake_case fields, while `IdlEvents` promises camelCase, so a raw decoder type-checks and then fails at runtime.
28. **`fetchRecentEvents` fetches transactions one at a time.** The public devnet RPC answers a `getTransactions` batch with a 429 for the whole batch, while single calls retry with backoff.
29. **Bootstrap funds the owner and device too,** beyond the agent and guard: the owner pays `init_vault` and allowlist rent, and the device pays its own approval fee. It tops a key up only below half its target, so rerunning changes nothing.
30. **`per_recipient_cap` in the demo vault is 200 dUSDC,** matching `per_tx_max`, so the mandate alone sets the tiers.
31. **The dUSDC mint authority is the CLI wallet.** `browserWallet` gets 500 dUSDC and no SOL from bootstrap, so Phase 5 can have it create and own a vault from the dashboard.
32. **The default model is `gpt-4o-mini`, set only in `.env.example`.** Code reads `OPENAI_MODEL` and refuses to start without it. Tested live: `gpt-6-luna` returns a 400 on `temperature`, and the spec needs temperature 0. `gpt-4o-mini` accepts temperature 0, tools and strict schemas through the Responses API. Its shutdown is announced for Jan 14, 2027.
33. **The demo task states approved amounts.** The judge never sees invoices, so with only "pay this week's invoices" it could not tell that an amount is inflated.
34. **`act()` proposes unlisted recipients, so it never reaches onchain `NotAllowlisted`.** The fooled payment to the attacker sits Pending. `demo:run` adds a labelled bypass probe, a direct `agent_execute` as a stolen agent key could send, to show the chain block too.
35. **`read_invoice` is confined to one folder, by real path and extension,** because an injection could otherwise make the executor read `.env` or `keys/`.
36. **A loop step is one model turn,** and parallel tool calls in it run one after another. Max 8.
37. **No automatic escalation after a guard denial.** The agent logs it and tells the model, because a fooled payment should not become a pending item by itself.
38. **The duplicate rule counts approvals even if the transaction never landed,** so its failure mode is a refused retry, not a double payment.
39. **A duplicate is the same recipient and amount with the same memo or under the same task.** The spec's recipient, amount and memo rule let a double payment through in a consistency run: after the guard denied the injected 190, the executor retried with the approved 60 under a new memo, and the judge, which cannot see past payments, approved it. The cost is that a task approving two identical amounts to one vendor gets the second refused.
40. **The PDFs sit in `demo/invoices/` and the text copies in `demo/invoices/txt/`,** which `list_invoices` does not descend into, so nothing gets paid twice.
41. **The chain decides every outcome in the console.** `buildTimeline` takes PAID, PENDING, REJECTED and BLOCKED BY CHAIN from chain history. The activity log adds only the "why", and guard denials, which never reach the chain, are labelled offchain. Model text is never a status.
42. **`/create` sends one atomic transaction,** so there is one popup and no half-made vault. It splits in two only if a size check says it will not fit, and it has fit so far with three vendors and a deposit.
43. **Live updates come from `onLogs(vault)`, with a 15-second poll behind it.** A log notification also fires for failed transactions, which an account subscription would miss. The activity log is polled every 3 seconds, because guard denials have no onchain signal.
44. **`ACTIVITY_SOURCE` defaults to the snapshot,** so a deployment cannot serve a log file by accident, and fields pass through a whitelist in `sanitizeActivity`.
45. **Anchor's browser build needs `fs` aliased away.** It references `fs` in `NodeWallet.local`, which a browser never calls, so `next.config.ts` points it at `lib/empty.ts` through Turbopack's `resolveAlias`.
46. **The dev burner is opt-in through `NEXT_PUBLIC_DEV_BURNER_KEY`,** because automation cannot click a wallet extension. It must stay unset on a deployment, where it would publish the key.
47. **Demo vault owners need a faucet, and retakes have limits.** `pnpm demo:faucet` uses the CLI wallet's mint authority. One vault per owner plus the guard's 24-hour duplicate rule mean a second `demo:run` on one vault gets its MEDIUM payments refused, which is correct.

## Phase status

Phase 5 is complete: the console works on devnet with a burner wallet through the full flow (create, `demo:run --vault`, live timeline, reject, revoke, approve while paused, unpause). `pnpm test:apps` runs 50 tests (one skipped without `RUN_LLM`), and `pnpm test:all` runs 92 against the program and SDK. The same flow with Phantom has not been run yet, since it needs a person to click the wallet. Screenshots are in `docs/screenshots/`.
