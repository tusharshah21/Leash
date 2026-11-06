# packages/sdk

The shared client for the Leash program, used by the agent, dashboard, device and MCP server. Builds as ESM plus types.

```bash
pnpm build:sdk
```

Run that after `anchor build` too: it copies the IDL from `target/` into `src/idl.ts`.

```ts
const agent = new LeashClient(new AnchorProvider(connection, new Wallet(agentKey), opts), owner);

// Picks execute (LOW, MEDIUM) or propose (HIGH) from the mandate.
const result = await agent.act(26_000_000n, recipient, "Invoice 42", { guard });
```

A client signs as its provider's wallet and is bound to one vault, so make one per identity.

| Export | Purpose |
|---|---|
| `LeashClient` | `fetchVault`, `fetchMandate`, `fetchPending`, `execute`, `propose`, `act`, `classify`, `fetchAllowlist`, `approve`, `reject`, `close`, `revoke`, `unpause`, `rotateKeys`, `onLeashEvent`, `fetchRecentEvents`, and `program` for the raw Anchor client |
| `vaultPda`, `vaultTokenPda`, `mandatePda`, `allowPda`, `pendingPda` | Account addresses |
| `reasonHash` | sha256 of a reason's text |
| `classifyTier` | Predicts the tier the program will route an action to |
| `describeError`, `errorName`, `LeashTxError` | Program errors as short messages. Client methods throw `LeashTxError`, with the signature when the transaction landed |
| `parseEvents`, `LeashEvent` | Decoded events |
| `patchClearDevice` | Makes a `rotate_keys` instruction remove the device key, which Anchor's TS coder cannot encode |
| `verifyReasoning`, `ActivityEntry` | Checks a logged reasoning against the `reason_hash` in an onchain event |

`@leash/sdk/node` holds what only Node can run, so the main entry stays browser-safe: `appendActivity`, `appendJsonl`, `readJsonl`, `redact`, `readKeypair`, `providerFor`, `vaultOwner`.

A guard is any `{ publicKey, signTransaction }`, so it can be a wallet in the same process or a remote service.

Test with `pnpm test:sdk` from the repo root. `anchor test` runs these too. `pnpm smoke:devnet` exercises the client against the deployed program.

## Added for the console

- `LeashClient.forVault(provider, vault)` reads the owner from the vault, so a client can follow a vault without holding the owner's key.
- `client.fetchHistory(limit, cache)` returns events and failed `agent_execute` attempts per signature. Pass the same `Map` each time, so a refresh only fetches what is new.
- `client.sendTx(tx)` sends a built transaction through the provider's wallet and maps failures to `LeashTxError`.
- `sanitizeActivity(entries, vault?)` keeps only whitelisted activity fields. The API route and `demo:snapshot` both use it.
- `clientFor(key)` in `@leash/sdk/node` honors `LEASH_VAULT`, which is how `--vault` reaches the agent and guard.
