import { strict as assert } from "node:assert";
import { test } from "node:test";
import { notifyPending } from "../src/notify.ts";

const notice = { vault: "V1", nonce: "7", amount: "190000000", recipient: "ATTACKER" };
const env = {
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_CHAT_ID: "c",
  NEXT_PUBLIC_SITE_URL: "https://x.dev/",
};

test("skips cleanly when not configured, and sends nothing", async () => {
  const never = (async () => assert.fail("should not send")) as unknown as typeof fetch;
  assert.equal(await notifyPending(notice, {}, never), false);
  assert.equal(await notifyPending(notice, { ...env, TELEGRAM_CHAT_ID: undefined }, never), false);
  assert.equal(
    await notifyPending(notice, { ...env, NEXT_PUBLIC_SITE_URL: undefined }, never),
    false
  );
});

test("sends chain facts and the Blink link", async () => {
  let url = "";
  let body: { chat_id: string; text: string } | undefined;
  const send = (async (u: string, init: RequestInit) => {
    url = u;
    body = JSON.parse(init.body as string);
    return new Response("{}");
  }) as unknown as typeof fetch;
  assert.equal(await notifyPending(notice, env, send), true);
  assert.equal(url, "https://api.telegram.org/bott/sendMessage");
  assert.equal(body!.chat_id, "c");
  assert.match(body!.text, /190 dUSDC to ATTACKER/);
  const link = new URL(body!.text.split("\n\n")[1]);
  assert.equal(link.host, "phantom.com");
  const page = new URL(decodeURIComponent(link.pathname.split("/").pop()!));
  assert.equal(page.origin + page.pathname, "https://x.dev/blink");
  assert.equal(page.searchParams.get("action"), "/api/actions/pending/V1/7");
  assert.equal(link.searchParams.get("ref"), "https://x.dev");
});

test("a refused message throws, for the caller to log", async () => {
  const send = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(notifyPending(notice, env, send), /401/);
});
