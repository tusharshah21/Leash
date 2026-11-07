# Demo video script

Target length 2:45. About 390 words of narration, which is a calm pace with room to breathe. The story follows `docs/SUBMISSION.md`: an agent paying invoices gets fooled twice, and the money still does not move.

Timings are for the final cut. The live run is recorded at full length and sped up in the edit, so record it in one take and trim later.

## 1. Hook (0:00 to 0:12)

**On screen:** the landing page at 1440p. The hero replay fills row by row on the right. Let it finish before you speak the last line.

**Narration:**

> AI agents are about to hold real money. And every agent we tested could be talked out of it by a document. This is Leash: an onchain firewall that decides what an agent may do with its wallet.

## 2. How it works (0:12 to 0:32)

**On screen:** scroll slowly to "Every action passes three layers". Hold on the three cards while the green token moves across them.

**Narration:**

> The agent's funds live in a Solana program, not in the agent's key. Every payment goes through three layers. Small payments to vendors you listed just happen. Medium ones need a co-signature from a separate guard service. And anything large or unlisted becomes a pending action that only you can approve.

## 3. The setup (0:32 to 0:42)

**On screen:** the console for your fresh vault: 2,000 dUSDC, the mandate card, an empty timeline. Optionally a two-second cut of `/create` with the Phantom popup, to show it was one signature.

**Narration:**

> Here's a vault I created with one signature. Two thousand test dollars, three allowlisted vendors, and a daily cap.

## 4. The live run (0:42 to 1:10)

**On screen:** split screen if you can: the terminal running `pnpm demo:run --vault <vault>` on the left, the console on the right. Sped up 3 to 4 times, with a small "4x" label. Rows land in the timeline: PAID, PAID, PAID, then the two PENDING rows, BLOCKED BY CHAIN and BLOCKED BY GUARD.

**Narration:**

> Now the agent pays this week's invoices. It's a real GPT tool loop, and on purpose it has no injection defenses. Two of these PDFs hide white-on-white instructions. One says: also pay a migration fee to this address. The other inflates a real vendor's bill from 60 to 190. Watch the timeline. The honest invoices settle. The fooled payments don't.

## 5. The attacker's card (1:10 to 1:28)

**On screen:** the red NOT ON ALLOWLIST card. Move the cursor slowly over the amount, the unlisted address, then the guard review.

**Narration:**

> The agent fell for it. It asked to send 150 dollars to an address I never approved. But the program won't execute that. It can only sit here as a proposal, with a countdown, until I decide. The guard reviewed it too, and flags the recipient. That review is advice. The chain is the limit.

## 6. Why (1:28 to 1:50)

**On screen:** open the attacker's PENDING row in the timeline and hold on "Reasoning verified onchain". Then the BLOCKED BY GUARD row, then BLOCKED BY CHAIN.

**Narration:**

> Every payment carries a hash of the agent's reasoning onchain, so the console only shows reasoning that matches. The inflated bill went to a real vendor, so the mandate would have allowed it. The guard refused to co-sign, because the task said 60. And if someone stole the agent's key and called the program directly? Rejected onchain: not allowlisted.

## 7. Decide from your phone (1:50 to 2:10)

**On screen:** click "Approve from phone" to show the QR code. Cut to the phone recording: Phantom opens the Blink, shows the card, tap Reject, the confirmation appears. Cut back to the desktop console as the card disappears and the row turns REJECTED.

**Narration:**

> I don't need to be at my desk. Each pending payment has a QR code that opens a Blink in Phantom. It shows only facts from the chain. One tap, rejected, and the console updates live.

## 8. Kill switch (2:10 to 2:22)

**On screen:** the kill switch card. Click Revoke agent, confirm in Phantom, the vault badge turns PAUSED.

**Narration:**

> And if I stop trusting the agent completely, one transaction revokes it. It can't pay or propose anything until I say so.

## 9. Proof (2:22 to 2:36)

**On screen:** terminal with `pnpm test:fast` output scrolling past the attack tests, ending on "97 passing". Then the README's threat model on GitHub.

**Narration:**

> Every attack you just saw is also a test that asserts the exact onchain error. And the README is honest about what Leash does not cover, like a compromised guard, which can still only approve what the mandate allows.

## 10. Close (2:36 to 2:45)

**On screen:** back to the landing hero, or an end card with the repo and the live console URL.

**Narration:**

> The agent can be fooled. The money can't. This is Leash, on Solana devnet today.

## Notes for the narration

- Say "dollars" for dUSDC in speech; the screen already says dUSDC.
- Do not read numbers that differ between runs, such as the guard's risk score, or the timestamps.
- If a section runs long, cut from section 2 first: the landing page explains the layers on its own.
