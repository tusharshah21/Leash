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
| `LeashClient` | `fetchVault`, `fetchMandate`, `fetchPending`, `execute`, `propose`, `act`, `classify`, `approve`, `reject`, `close`, `revoke`, `unpause`, `rotateKeys`, `onLeashEvent`, `fetchRecentEvents`, and `program` for the raw Anchor client |
| `vaultPda`, `vaultTokenPda`, `mandatePda`, `allowPda`, `pendingPda` | Account addresses |
| `reasonHash` | sha256 of a reason's text |
| `classifyTier` | Predicts the tier the program will route an action to |
| `describeError`, `errorName`, `LeashTxError` | Program errors as short messages. Client methods throw `LeashTxError`, with the signature when the transaction landed |
| `parseEvents`, `LeashEvent` | Decoded events |
| `patchClearDevice` | Makes a `rotate_keys` instruction remove the device key, which Anchor's TS coder cannot encode |

A guard is any `{ publicKey, signTransaction }`, so it can be a wallet in the same process or a remote service.

Test with `pnpm test:sdk` from the repo root. `anchor test` runs these too. `pnpm smoke:devnet` exercises the client against the deployed program.
