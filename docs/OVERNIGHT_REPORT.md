# Overnight report

Branch `overnight`, from `main` at `3530e1d`. Nothing was merged into `main`, the devnet program was not upgraded, no existing vault was touched, and nothing was submitted to MLH.

## What to do in the morning

1. Read this file, then skim the diff: `git log --oneline main..overnight` and `git diff main...overnight --stat`.
2. Watch `demo/video/leash-draft.mp4` (the fallback cut).
3. Restore your web env file: `cp keys/env.local.orig.bak apps/web/.env.local`. Overnight it pointed the dev burner at a burner wallet I created (see "Wallets and spend").
4. Merge `overnight` into `main` when happy (a fast-forward is possible: nothing else landed on `main`). Vercel then redeploys the console with the new landing and pending card.
5. Follow `docs/RECORDING_CHECKLIST.md`, then narrate from `docs/VIDEO_SCRIPT.md`.

## Commits

| Commit | What |
|---|---|
| `0883580` | Console history loads in parallel and retries partial results; `pnpm demo:check` |
| `11ca650` | Landing hero with the attack replay panel, stronger pending card |
| `6eac27a` | Landing stats on Vercel, neutral buttons for visitors, mobile create stepper |
| `97256ce` | Automated draft video and before and after screenshots |
| `2a43237` | Voiceover script and recording checklist |
| last | `build:sdk` works on a fresh clone; this report |

## Task 1: design polish

Screenshots at 1440 and 390 of the landing, console, pending card, why panel, `/create` and `/blink`. The top 10 issues, all fixed:

1. **Landing scrolled sideways.** The token track's `translateX(100%)` made the page 2,656px wide at a 1440 viewport. The track now clips with `overflow-hidden`.
2. **The hero had no proof.** It now has an attack replay panel beside the headline: the five demo rows with their real outcomes (PAID, PENDING, BLOCKED BY CHAIN, BLOCKED BY GUARD) and "Attacker received 0 dUSDC", animated in row by row.
3. **Landing scenario tags looked unlike the console.** They now use the console's `OutcomeBadge`, so a judge sees the same vocabulary on both pages.
4. **The attacker card did not read as dangerous.** A solid red "NOT ON ALLOWLIST" header band (amber "NEEDS YOUR APPROVAL" for listed vendors) with the expiry countdown, the amount at `text-4xl`, "Unlisted address" in red, and an explicit "Nothing moves until you approve" line.
5. **The guard's risk was a bare word.** A risk meter bar now sits beside it.
6. **Mobile console showed the mandate first.** On phones the order is now pending, timeline, then the mandate and vault cards.
7. **The timeline showed only offchain rows after a reload** while devnet history was still loading or rate-limited. History now loads 4 transactions at a time, a partial result schedules a retry, and the timeline shows skeleton rows until the first load. Measured: correct 7.0s after the queue emptied, where before it was still wrong when checked.
8. **Timeline labels.** A blocked direct transfer showed an empty tier (now `DIRECT`), and unlisted recipients read "Unknown" (now `Unlisted 4xQm...`, also in Blink text and the card image).
9. **The mandate card's reset sentence was broken** after the window ended. It now reads "A fresh window starts at the agent's next action."
10. **The mobile `/create` stepper** hid the step numbers and squeezed the labels. Numbers are always visible and the current step's name shows on mobile.

Also fixed: visitors (not the owner) saw red and green approve and reject buttons that did nothing, now neutral outline buttons; the replay panel truncated on mobile, now the tier column hides below `sm`; and the landing stats returned 502 in production (see Risks).

## Task 2: demo robustness

Burner owner `CnZf7qf6DUoTUxb2zM4qi42c3xgiY8EjkCKfYXU89o2E`, vault `8jtJHwkDgTepYqYfb3kV54k6KuQTsxFv3qW3Eh8Sghrx` (key in `keys/overnight-burner.json`, gitignored).

- 3 full loops passed: create at `/create`, `demo:run` matching the scenarios with the attacker at 0, approve DataLabs 340 and reject the attacker 150 through the Blink POST routes, revoke, close, `guard:reset-demo`. A 4th loop after the history fix passed too, and 4 more `demo:run`s ran during the video takes, all matching.
- The flakiness found was the timeline one (item 7 above). A second issue: `demo:run` with a guard already running on 8787 talked to the wrong guard. It now refuses to start and says why.
- New `pnpm demo:check [--vault <address>] [--site <url>]`, read-only. It checks the RPC, OpenAI and the model, the guard port, keys, the vault (not paused, keys match), mandate room for a run (243 dUSDC), the allowlist, waiting pendings, guard approvals in the last 24 hours (which would refuse retakes), vault dUSDC (583 needed), owner, agent and CLI SOL, the attacker balance and the console URL. It prints GO or NO-GO and exits non-zero on NO-GO. On the burner vault it gave GO with no warnings.
- The burner vault is left revoked (paused) after the last take.

## Task 3: draft video

`demo/video/leash-draft.mp4`: 2:26, 1440x900, H.264 (`-preset veryfast`, crf 18), 13.9MB, no audio. It follows `docs/SUBMISSION.md`: title, landing, empty console, `demo:run` sped up 3x, the timeline, the attacker card, the why panel (verified reasoning, guard, chain rows), the phone QR, the Blink reject, the kill switch, the test suite, the threat model and an end card. Captions are burned in.

To regenerate: `demo/video/record.mjs` records one Playwright video per scene (Windows Chrome, `playwright-core`), then `demo/video/build.mjs` cuts and concatenates with ffmpeg. Each scene gets its own browser context because Playwright's recorder drifts by seconds over a long take; intermediate files go to `demo/video/out/` (gitignored).

## Task 4: docs

- `docs/VIDEO_SCRIPT.md`: 10 scenes from 0:00 to 2:45, with narration, what is on screen and timings.
- `docs/RECORDING_CHECKLIST.md`: env and build steps, preparing a Phantom vault for `J2nB...` (it has 0.30 SOL, 2,500 dUSDC and no vault yet; its vault will be `Ga9aCd8abNrmMh2bfJR5Jr6Par9LHDLyJ8EnXn9Ggx8w`), `guard:reset-demo`, `demo:check`, OBS settings, phone capture and the order of takes.

## Task 5: QA

- **Fresh clone** (`git clone --branch overnight`, then the README in order). `pnpm build:sdk` failed: `sync-idl` reads `target/`, which only exists after `anchor build`, and the README runs it first. This was already true on `main`. `sync-idl` now keeps the committed `src/idl.ts` when there is no build, tested in an empty tree. In the clone, the typecheck and 5 `test:apps` failures that followed were all "Cannot find module '@leash/sdk'", from the missing `dist/`. Lint, `test:sdk` (17) and `anchor build --ignore-keys` passed. The clone's `anchor test` and web build were cut short: Claude Code killed the background jobs when the Windows host ran low on memory. Rerun the README steps on a fresh clone once to close this out.
- **Links.** Every README link and every explorer transaction and address resolves. `solana.com` answers scripts with 429 (bot protection) and was not checked in a browser.
- **Mobile.** All pages at 390px, before and after shots below. No horizontal scroll left.
- **Console errors.** None on the local dev or production builds during the e2e runs and screenshots. Production `main` logs one, the `/api/stats` 502.
- **Lighthouse, landing.** Production `main`: performance 69, accessibility 100, best practices 96 (the stats 502), SEO 100. Local production build of `overnight`: desktop 97/100/100/100, mobile 67/100/100/100.
- **Mobile performance, not fixed.** LCP 3.8s and TBT 1,010ms. The LCP element is the server-rendered hero paragraph, delayed by 1.3s of script evaluation in one chunk: the wallet adapter, web3.js and Anchor, which load on every page through the layout's `Providers` and the header's wallet button. The fix is to load the wallet providers only on the console, `/create` and `/blink`, or to load them after hydration. That touches the layout and every wallet hook, too much to risk the night before submission.

## Tests

| Gate | Result | Run on |
|---|---|---|
| `pnpm test:fast` (program and SDK) | 97 passing, 2 pending | `2a43237`, unchanged since in program or SDK code |
| `pnpm test:apps` | 81 tests, 80 pass, 1 skipped (`RUN_LLM`), 0 fail | final tree |
| `pnpm test:sdk` | 17 passing | final tree |
| `pnpm typecheck`, `pnpm lint` | clean | final tree |
| `pnpm --filter web build` | OK | `2a43237`; the last commit touches no web code |
| `pnpm demo:check` on the burner vault | GO, 0 failed, 0 warnings | after the final take |

The last commit changes only `packages/sdk/scripts/sync-idl.mjs` and this report, so the validator suite was not run again after it. The memory kill (Task 5) was the reason.

## Before and after screenshots

In `docs/screenshots/overnight/`:

| Before | After |
|---|---|
| `before-landing-1440.png` | `after-landing-1440.png` |
| `before-landing-full-1440-overflow.png` | `after-landing-full-1440.png` |
| `before-landing-full-390.png` | `after-landing-full-390.png` |
| `before-console-1440.png` | `after-console-1440.png` |
| `before-console-full-390.png` | `after-console-full-390.png` |
| `before-pending-card-1440.png` | `after-pending-card-1440.png` |
| `before-pending-card-390.png` | `after-pending-card-390.png` |
| `before-why-1440.png` | `after-why-verified-1440.png`, `after-why-guard-1440.png` |
| `before-blink-1440.png` | `after-blink-1440.png` |
| `before-blink-390.png` | `after-blink-390.png` |
| `../create-mobile-1-mandate.png` | `after-create-1-390.png`, `after-create-4-390.png` |
| | `after-create-1-1440.png`, `after-phone-qr-1440.png` |

## Wallets and spend

- CLI wallet: 2.523 SOL at the start, 2.426 at the end, so 0.097 SOL spent (limit 0.3). It went to funding the burner and topping up the agent during the runs.
- The burner got 3,000 dUSDC from `demo:faucet` over the night.
- `apps/web/.env.local` points `NEXT_PUBLIC_DEV_BURNER_KEY` at the burner. The original is in `keys/env.local.orig.bak`.

## Risks

- **The `/api/stats` fix is unverified on Vercel.** Production returned 502 "devnet is unreachable". The route now uses `LEASH_RPC_URL` (set it in Vercel if it is not there), returns partial numbers when one call fails, and returns 502 only if both fail. If the landing still shows n/a after the merge, check that variable first.
- **The Vercel preview for `overnight` is behind Vercel's login,** so I could not test it. It built successfully. Everything else was tested locally against devnet.
- **`fetchHistory` in the SDK changed.** It returns the same array, now with a `partial` property, and fetches 4 transactions at a time. On the public RPC that is more 429s, which it already handled; with Helius it is faster.
- **A 14MB video is committed to git.** Drop `97256ce`'s video with `git rm` before merging if you would rather link it.
- **Mobile Lighthouse performance is 67,** see Task 5.

## Review before merging

1. Watch the video. The pacing of the `demo:run` scene is the part most likely to need a retake.
2. Look at the before and after pairs for the landing and the pending card. These are taste calls.
3. Check that the landing hero copy says what you want.
4. Confirm `LEASH_RPC_URL` is set in Vercel's production environment.
5. The local dev server was stopped (memory). Start it again with `pnpm dev:web` before recording.
