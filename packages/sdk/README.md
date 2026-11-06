# packages/sdk

TypeScript helpers for the Leash program. The full client comes later.

- `classifyTier`: predicts which tier the program will route an action to, so a client can pick `agent_execute` or `agent_propose` up front.
- `patchClearDevice`: makes a `rotate_keys` instruction remove the device key, which Anchor's TS coder cannot encode.

Test with `pnpm test:sdk` from the repo root. `anchor test` runs these too.
