# Leash

Onchain firewall for AI agents, built for the MLH Solana Hackathon (Nov 6-8, 2026). A Solana program enforces what an agent may do with funds through three layers: an owner-signed mandate (caps, allowlist, expiry), a required guard-AI co-signature for medium-risk actions, and onchain PendingActions for high-risk actions that only the owner or a hardware device key can approve.

## Architecture

| Path | Status | Purpose |
|---|---|---|
| `programs/leash` | Phase 2 | The Anchor program |
| `tests/` | Phase 2 | Mocha tests against a local validator: `helpers.ts` (shared), `leash.ts` (owner paths), `attacks.ts` (tier routing, attacks, approvals) |
| `packages/sdk` | Partial | `classifyTier` and `patchClearDevice`. The full client comes later |
| `apps/agent` | Stub | The AI agent |
| `apps/web` | Stub | Owner dashboard |
| `apps/mcp` | Stub | MCP server |
| `device/unoq` | Stub | Hardware device key firmware |
| `demo` | Stub | Demo scripts and assets |

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
| Owner | `init_vault`, `set_mandate`, `add_recipient`, `remove_recipient`, `deposit`, `withdraw`, `unpause`, `rotate_keys` |
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
| 6011 | `PendingExpired` | Approve or reject after `created_at + pending_ttl_secs` |
| 6012 | `PendingNotActive` | Approve or reject when status is not `Pending` |
| 6013 | `RecipientMismatch` | Approve to a token account with the wrong owner or mint |
| 6014 | `MathOverflow` | Checked arithmetic overflowed |

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

## Commands

```bash
anchor build
```
```bash
anchor test
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
anchor deploy --provider.cluster devnet
```

`anchor test` takes about 7 minutes, because two tests wait out the 60-second minimum durations in real time. It also runs the SDK tests, and it stops the validator when it finishes. `pnpm test:sdk` runs alone in under a second.

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
20. **Human authority survives a pause and an expired mandate.** `approve_pending` and `reject_pending` check neither. Reject does respect the TTL, so an expired action stays `Pending` forever; it can never move funds.
21. **`approve_pending` rolls an elapsed window first,** so the spend counts against the current window and not one that has ended.
22. **`window_secs` and `pending_ttl_secs` came out of `_reserved`.** A compile-time assert pins `Mandate::INIT_SPACE` at 113. The window is fixed rather than sliding: it restarts on the first agent action or approval after it ends.
23. **The four action events carry a `vault` field,** like every other event, so a dashboard can attribute them.
24. **PendingActions are never closed.** Their rent stays locked, which is cheap and keeps the audit trail. The agent pays it, so it can only spam proposals with its own SOL. Reclaiming rent is on the README roadmap.

## Phase status

Phase 2 is complete: 84 tests pass, 71 against the program and 13 in the SDK. Phase 3 (deploy) has not started.
