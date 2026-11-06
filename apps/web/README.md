# apps/web

The Leash console. Next.js App Router, Tailwind, and Wallet Standard through Solana Wallet Adapter, so Phantom and MetaMask appear by themselves. Devnet only.

| Route | What it does |
|---|---|
| `/` | The pitch, the three layers, live program stats |
| `/console/[vault]` | Any vault, read-only without a wallet. The owner can approve, reject, revoke and unpause |
| `/create` | Mandate, allowlist and deposit in one signature, then a redirect to the new console |

The UI treats the chain as truth. `lib/timeline.ts` takes each outcome from chain history; the activity log only adds the "why", and reasoning is checked against the onchain hash. Guard denials never reach the chain, so they come from the log and are labelled as offchain.

## Run locally

From the repo root, after `pnpm install`:

```bash
cp apps/web/.env.example apps/web/.env.local
```
```bash
pnpm dev:web
```

Then open <http://localhost:3000>, connect a devnet wallet, and create a vault at `/create`. It needs dUSDC to deposit and about 0.012 SOL:

```bash
pnpm demo:faucet <your wallet> 2000 --sol 0.05
```

Point the agent at the vault and watch the console. The attacker's payment arrives as a red pending card, which you reject from your wallet:

```bash
pnpm demo:run --vault <your vault>
```

The owner's key is not needed for that. `demo:run` starts its own guard, and needs `OPENAI_API_KEY` in the root `.env`.

A second run on the same vault behaves differently, correctly: the guard refuses repeated MEDIUM payments as duplicates for 24 hours, and the daily cap stays used. Rehearse on a throwaway vault and record once.

## Environment

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_LEASH_RPC_URL` | Devnet RPC, falling back to the public endpoint. **It ships to the browser**, so restrict a paid key by domain before deploying |
| `ACTIVITY_SOURCE` | `file` reads `logs/activity.jsonl` for local use. Anything else, including unset, redirects to the static snapshot, so a deployment cannot serve a log file |
| `NEXT_PUBLIC_DEV_BURNER_KEY` | Local testing only: a JSON secret key that adds a "Dev burner" wallet. Leave it unset on any deployment, because it would publish that key |

## Deploy to Vercel

1. Import the repo and set the Root Directory to `apps/web`, leaving "Include files outside the root directory" on. Vercel finds the pnpm workspace from the lockfile, and `prebuild` builds the SDK.
2. Set `NEXT_PUBLIC_LEASH_RPC_URL`, and leave `ACTIVITY_SOURCE` and the burner key unset.
3. To show reasoning on the deployment, run `pnpm demo:snapshot --vault <vault>`, then commit `apps/web/public/activity-snapshot.json`. It holds whitelisted fields only. Chain data is always live.

## Tests

`test/timeline.test.ts` covers the merge logic and runs with `pnpm test:apps`. The rest of the app is verified by `pnpm --filter web build` and by running the flow above.
