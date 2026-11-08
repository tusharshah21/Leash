# Recording checklist

For the morning of Nov 8. Submission closes at 1:00 PM EST, which is 11:30 PM IST. The fallback cut is `demo/video/leash-draft.mp4` if a take goes wrong and time runs short.

Every command runs in WSL from the repo root (`wsl -d Ubuntu-24.04 -u tushar`, then `cd ~/projects/leash`).

## 1. Code and build (5 minutes)

1. Review and merge the `overnight` branch, or check it out, so the recording has the new landing hero and pending card.
2. Build the SDK, because the apps import its `dist/`:

```bash
pnpm build:sdk
```

3. In `apps/web/.env.local`, check three things:
   - `ACTIVITY_SOURCE=file`, so the console shows reasoning and guard decisions from `logs/`.
   - `NEXT_PUBLIC_SITE_URL=https://leash-ruddy.vercel.app`, so the QR code opens a site the phone can reach. Leave it unset only if you will not film the phone.
   - `NEXT_PUBLIC_DEV_BURNER_KEY` commented out, so the wallet menu only offers Phantom. The original line is backed up in `keys/env.local.orig.bak` (see `docs/OVERNIGHT_REPORT.md`).
4. Start the console and leave it running:

```bash
pnpm dev:web
```

5. Do not start `pnpm guard` yourself: `demo:run` starts its own guard, and refuses to run if another one holds port 8787.

## 2. A fresh vault on your main Phantom (5 minutes)

1. Phantom: Settings, Developer settings, Testnet mode on, Solana devnet.
2. Make sure the wallet has test funds. On the night of Nov 7 it had 0.30 SOL, 2,500 dUSDC and no vault, which is enough. If it runs low, this sends 2,000 dUSDC and 0.05 SOL from the CLI wallet:

```bash
pnpm demo:faucet J2nBcSoqjH662JZ5U2uTVb1QuaDir8e6kkKaswrtEukq 2000 --sol 0.05
```

3. Its vault address will be `Ga9aCd8abNrmMh2bfJR5Jr6Par9LHDLyJ8EnXn9Ggx8w` (one vault per owner, so it is the same after every recreate). If the wallet already has a vault, `/create` sends you to its console. Revoke the agent there, then close the vault in the danger zone by typing CLOSE. Tokens and rent come back.
4. Open `http://localhost:3000/create`, keep the defaults (25, 200, 500, 7 days, all three vendors, 2,000 deposit), and sign once in Phantom. Note the vault address from the console URL.
5. Clear any old guard history for that address, so the guard does not refuse the run as a duplicate:

```bash
pnpm guard:reset-demo --vault <vault>
```

## 3. Preflight

```bash
pnpm demo:check --vault <vault>
```

It must print `GO`. Each line says what to fix. Common ones: a guard already running (stop it), the daily cap already used (close and recreate the vault), guard history present (step 2.5), or the console not running (step 1.4). Warnings do not block, but read them.

## 4. Screen and OBS

- Display at 2560x1440, Windows scaling 100%. Chrome full screen (F11) with no bookmarks bar, and zoom 125% if text looks small at 1440p, or 100% to match the draft.
- Close every other tab and notification source. Windows Focus Assist on, Slack and mail closed.
- OBS, Settings, Video: base and output resolution 2560x1440, 60 fps (30 is fine).
- OBS, Settings, Output, Recording: format MKV (remux to MP4 afterwards with File, Remux Recordings), encoder NVENC H.264 if available, otherwise x264. Rate control CQP at 18 (NVENC) or CRF 18 (x264), keyframe interval 2 s.
- Audio: record narration separately afterwards over the edit, or on its own track. Mute desktop audio.
- One OBS scene with the browser window, a second with the browser and a terminal side by side for the live run (terminal font at 18 pt or larger).

## 5. Phone capture

- Phone in dark mode, Do Not Disturb on, battery above 50%, Phantom on devnet with the same wallet imported.
- iPhone: Control Center, Screen Recording. Android: Quick Settings, Screen recorder, no audio.
- Test once before the real take: scan a QR code from the console and confirm the Blink page opens in Phantom.

## 6. Order of takes

Some steps can only happen once per vault. Do the repeatable ones first, and protect the one-shot ones.

| # | Take | Repeatable? | Notes |
|---|---|---|---|
| 1 | Landing hero and the three layers | Yes | Reload to replay the hero rows. Record two or three takes. |
| 2 | `/create`, optional | Only before step 2.4 | If you want the one-signature moment, film step 2.4 itself. |
| 3 | Live run: `pnpm demo:run --vault <vault>` with the console beside the terminal | **Once per vault** | About 100 seconds. Do not touch the console while it runs. A retake needs revoke, close, recreate, `guard:reset-demo` and `demo:check` again. |
| 4 | Attacker card, then the "why" rows in the timeline | Yes, until you decide the card | Open the attacker's PENDING row for "Reasoning verified onchain", then BLOCKED BY GUARD, then BLOCKED BY CHAIN. |
| 5 | Phone: scan the attacker card's QR, reject in Phantom | **Once** | Start the phone recording and OBS together. Film the desktop console updating afterwards. |
| 6 | Approve DataLabs 340 from the desktop, optional | **Once** | Shows the human path paying a real vendor. |
| 7 | Kill switch: Revoke agent | Repeatable with Unpause | Phantom asks for one signature. Unpause afterwards to retake. |
| 8 | `pnpm test:fast` output | Yes | Takes about 70 seconds. Record the end, or scroll the saved output. |
| 9 | README threat model on GitHub | Yes | `https://github.com/tusharshah21/Leash#threat-model` |

## 7. After recording

- Remux the MKV files to MP4 in OBS before editing.
- Keep the live-run take at 3x to 4x speed in the edit, labelled.
- Upload, then put the link in `docs/SUBMISSION.md` under Links, replacing "to be added".
- If anything fails and time is short, upload `demo/video/leash-draft.mp4`. It has captions and no voice.
