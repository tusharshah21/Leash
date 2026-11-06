# Leash

Onchain firewall for AI agents, built for the MLH Solana Hackathon (Nov 6-8, 2026). A Solana program enforces what an agent may do with funds through three layers: an owner-signed mandate (caps, allowlist, expiry), a required guard-AI co-signature for medium-risk actions, and onchain PendingActions for high-risk actions that only the owner or a hardware device key can approve.

## Architecture

| Path | Status | Purpose |
|---|---|---|
| `programs/leash` | Phase 1 | The Anchor program |
| `tests/leash.ts` | Phase 1 | Mocha tests against a local validator |
| `packages/sdk` | Stub | TypeScript client |
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
| Mandate | `["mandate", vault]` | low_threshold, per_tx_max, daily_cap, spent_today, window_start, expires_at |
| AllowEntry | `["allow", vault, recipient]` | recipient, label, per_recipient_cap |
| PendingAction | `["pending", vault, nonce_le_bytes]` | vault, recipient, amount, reason_hash, status, created_at |

### Instructions

Owner only: `init_vault`, `set_mandate`, `add_recipient`, `remove_recipient`, `deposit`, `withdraw`, `unpause`, `rotate_keys`. Owner or device: `revoke_agent`. Phase 2: `agent_execute`, `approve_pending`, `reject_pending`.

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
anchor keys sync
```
```bash
anchor deploy --provider.cluster devnet
```

The program keypair is `target/deploy/leash-keypair.json`, which is gitignored. Back it up: deleting `target/` without a copy changes the program ID.

## Coding conventions

- All token amounts are `u64`. All arithmetic is checked.
- Size accounts with `InitSpace`. Seeds live in `constants.rs`.
- One file per instruction in `programs/leash/src/instructions/`, each exposing `handle_<name>`.
- Owner checks use `has_one = owner @ LeashError::Unauthorized` with seeds derived from `vault.owner`, so a wrong signer on a real vault fails with `Unauthorized`.
- Every state change emits an event from `events.rs`.
- Negative tests are named as attacks and assert the exact error code.
- Keep secrets out of git: `.env*` and keypair JSON files are ignored. Check `git ls-files` before committing.
- Prose: no em dashes, and no hard-wrapped Markdown paragraphs.
- Commits: conventional style, no AI attribution. The developer pushes; never run `git push`.

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
