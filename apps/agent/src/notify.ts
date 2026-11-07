// Optional Telegram message when a proposal needs a human. It carries chain facts and the link only,
// never model text, because that text may repeat what an attacker wrote into an invoice.

export interface PendingNotice {
  vault: string;
  nonce: string;
  /** Base units, as a string. */
  amount: string;
  recipient: string;
}

/** Sends the notice. False means it was not configured, and nothing was sent. */
export async function notifyPending(
  notice: PendingNotice,
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch
): Promise<boolean> {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat, NEXT_PUBLIC_SITE_URL: site } = env;
  if (!token || !chat || !site) return false;

  const origin = site.replace(/\/$/, "");
  const path = `/api/actions/pending/${notice.vault}/${notice.nonce}`;
  const page = `${origin}/blink?action=${encodeURIComponent(path)}`;
  const link = `https://phantom.com/ul/browse/${encodeURIComponent(page)}?ref=${encodeURIComponent(
    origin
  )}`;
  const dusdc = Number(notice.amount) / 1e6;
  const res = await send(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text: `Leash: a payment of ${dusdc} dUSDC to ${notice.recipient} needs your decision.\n\n${link}`,
    }),
  });
  if (!res.ok) throw new Error(`Telegram answered ${res.status}`);
  return true;
}
