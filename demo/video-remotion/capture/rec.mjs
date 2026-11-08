// node final/rec.mjs <phase>. Phases: create, run, post, landing, tests. All against the live site.
import { join } from "node:path";
import {
  CLIPS, SITE, BURNER, newPage, record, moveTo, hover, click, scrollBy, until, sleep, wsl, log, setLog,
  saveJson, loadJson,
} from "./lib.mjs";

const phase = process.argv[2];
setLog(join(CLIPS, "rec.log"));
const state = loadJson("state.json", {});
const links = loadJson("links.json", {});
const saveLinks = () => saveJson("links.json", links);
const txLinks = (text) => [...text.matchAll(/https:\/\/explorer\.solana\.com\/tx\/\w+\?cluster=devnet/g)].map((m) => m[0]);

async function pageLinks(page) {
  return page.$$eval('a[href*="explorer.solana.com/tx/"]', (as) => [...new Set(as.map((a) => a.href))]);
}

async function terminal(name, cmd, rec) {
  const lines = [];
  const t0 = rec?.t0 ?? Date.now() / 1000;
  const r = await wsl(cmd, (l) => {
    const line = l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
    lines.push({ t: +(Date.now() / 1000 - t0).toFixed(2), line });
    if (line.trim()) log(`  | ${line.slice(0, 160)}`);
  });
  saveJson(`${name}-terminal.json`, { cmd, code: r.code, lines });
  return r;
}

if (phase === "create") {
  const page = await newPage();
  await page.goto(`${SITE}/create`, { waitUntil: "networkidle" });
  const rec = await record(page, "create");
  await sleep(1500);
  rec.mark("mandate");
  for (const label of ["LOW threshold", "Per-transaction limit", "Daily cap"]) {
    await hover(page, page.getByText(label, { exact: true }), { ms: 700 });
    await sleep(900);
  }
  await click(page, page.getByRole("button", { name: "Continue" }));
  rec.mark("allowlist");
  await sleep(2500);
  await click(page, page.getByRole("button", { name: "Continue" }));
  rec.mark("deposit");
  await sleep(2000);
  await click(page, page.getByRole("button", { name: "Continue" }));
  rec.mark("review");
  await sleep(2500);
  await click(page, page.getByRole("button", { name: "Create vault" }));
  rec.mark("signed");
  await page.waitForURL(/\/console\//, { timeout: 180000 });
  state.vault = page.url().split("/console/")[1].split(/[?#]/)[0];
  saveJson("state.json", state);
  rec.mark("console", { vault: state.vault });
  await sleep(6000);
  links.create = await pageLinks(page);
  saveLinks();
  await rec.finish();
  log("vault", state.vault);
}

if (phase === "run") {
  const page = await newPage();
  await page.goto(`${SITE}/console/${state.vault}`, { waitUntil: "networkidle" });
  await page.getByText("No agent activity on this vault yet.").waitFor({ timeout: 90000 });
  const rec = await record(page, "run");
  await sleep(2500);
  rec.mark("start");
  let done = false;
  const run = terminal("run", `pnpm demo:run --vault ${state.vault}`, rec).then((r) => ((done = true), r));
  // Drift the cursor toward the timeline while the agent works, without clicking anything.
  const tl = page.locator("section", { hasText: "Timeline" }).last();
  await sleep(4000);
  await hover(page, tl, { dx: 0.3, dy: 0.15, ms: 1400 });
  while (!done) await sleep(1000);
  const r = await run;
  rec.mark("run-exit", { code: r.code });
  links.run = txLinks(r.out);
  saveLinks();
  await until(page, async () => (await page.locator("article").count()) >= 2, 90000, "two pending cards");
  rec.mark("cards");
  await until(page, async () => (await page.locator("ol li").count()) >= 5, 90000, "timeline rows");
  rec.mark("timeline");
  await sleep(2000);
  await hover(page, page.locator("article").first(), { dx: 0.5, dy: 0.2, ms: 1200 });
  await sleep(6000);
  await rec.finish();
  if (r.code !== 0) throw new Error("demo:run exited non-zero, see run-terminal.json");
}

if (phase === "post") {
  const V = state.vault;
  // 1. Desktop: the red card and the "why" panel.
  // The live site only has offchain reasoning from the committed snapshot; WHY_SITE can point
  // this part at a local production build that reads the log instead.
  const page = await newPage();
  await page.goto(`${process.env.WHY_SITE || SITE}/console/${V}`, { waitUntil: "networkidle" });
  await page.locator("article").nth(1).waitFor({ timeout: 90000 });
  await page.locator("ol li").nth(4).waitFor({ timeout: 90000 });
  await sleep(2500);
  const rec = await record(page, "why");
  await sleep(1500);
  const attack = page.locator("article").filter({ hasText: "NOT ON ALLOWLIST" }).first();
  rec.mark("redcard");
  await hover(page, attack, { dx: 0.25, dy: 0.08, ms: 1200 });
  await sleep(1500);
  await hover(page, attack.getByText(/Unlisted address/).first(), { ms: 900 });
  await sleep(2500);
  const rows = page.locator("ol li details");
  const attackRow = rows.filter({ hasText: /150[\s\S]*PENDING/ }).first();
  rec.mark("why-verified");
  await click(page, attackRow.locator("summary"));
  await sleep(1200);
  const verified = page.getByText(/Reasoning verified onchain/).first();
  if (await verified.count()) await hover(page, verified, { ms: 900 });
  else log("WARN: no 'Reasoning verified onchain' text on the attacker row");
  await sleep(5000);
  await click(page, attackRow.locator("summary"));
  const guardRow = rows.filter({ hasText: "BLOCKED BY GUARD" }).first();
  rec.mark("why-guard");
  await click(page, guardRow.locator("summary"));
  await sleep(5500);
  await click(page, guardRow.locator("summary"));
  const chainRow = rows.filter({ hasText: "BLOCKED BY CHAIN" }).first();
  rec.mark("why-chain");
  await click(page, chainRow.locator("summary"));
  await sleep(5000);
  await click(page, chainRow.locator("summary"));
  await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(1200);
  // The QR for the attacker's card.
  rec.mark("qr");
  await click(page, attack.getByRole("button", { name: /Approve from phone/ }));
  await sleep(4500);
  const rejectHref = await page.getByRole("link", { name: "Open here" }).getAttribute("href");
  await page.keyboard.press("Escape");
  await sleep(800);
  const data = page.locator("article").filter({ hasText: "DataLabs" }).first();
  await data.getByRole("button", { name: /Approve from phone/ }).click();
  const approveHref = await page.getByRole("link", { name: "Open here" }).getAttribute("href");
  await page.keyboard.press("Escape");
  await sleep(500);
  rec.mark("end");
  links.consoleBefore = await pageLinks(page);
  saveLinks();
  await rec.finish();

  // 2. Phone: reject the attacker, approve DataLabs, through the Blink.
  for (const [name, href, label] of [
    ["blink-reject", rejectHref, "Reject"],
    ["blink-approve", approveHref, "Approve"],
  ]) {
    const u = new URL(href);
    const phone = await newPage({ phone: true });
    await phone.goto(`${SITE}${u.pathname}${u.search}`, { waitUntil: "networkidle" });
    const btn = phone.getByRole("button", { name: label, exact: true });
    await btn.waitFor({ timeout: 60000 });
    await until(phone, () => btn.isEnabled(), 30000, "blink button enabled");
    const prec = await record(phone, name);
    await sleep(2000);
    prec.mark("card");
    await scrollBy(phone, 250, 1200);
    await sleep(2500);
    prec.mark("tap");
    await click(phone, btn);
    const status = phone.getByRole("status").filter({ hasText: /View transaction/ });
    await status.waitFor({ timeout: 120000 });
    prec.mark("done", { text: (await status.innerText()).replace(/\s+/g, " ") });
    await status.scrollIntoViewIfNeeded();
    links[name] = await status.locator("a").first().getAttribute("href");
    saveLinks();
    await sleep(4000);
    await prec.finish();
    await phone.context().close();
  }

}

if (phase === "after") {
  // 3. Desktop: the timeline settles, then the kill switch.
  const V = state.vault;
  const page = await newPage();
  await page.goto(`${SITE}/console/${V}`, { waitUntil: "networkidle" });
  const rec2 = await record(page, "after");
  await sleep(1000);
  await until(page, async () => {
    const t = await page.locator("ol").last().innerText();
    return /340[\s\S]*PAID/.test(t) && /REJECTED/.test(t) && (await page.locator("article").count()) === 0;
  }, 120000, "timeline shows PAID 340 and REJECTED");
  rec2.mark("settled");
  await hover(page, page.locator("ol li").filter({ hasText: "REJECTED" }).first(), { ms: 1200 });
  await sleep(2500);
  await hover(page, page.locator("ol li").filter({ hasText: /340/ }).first(), { ms: 900 });
  await sleep(2500);
  rec2.mark("revoke");
  await click(page, page.getByRole("button", { name: "Revoke agent" }));
  await sleep(1500);
  await click(page, page.locator("dialog").getByRole("button", { name: "Revoke agent" }));
  await page.getByText("PAUSED", { exact: true }).waitFor({ timeout: 120000 });
  rec2.mark("paused");
  await hover(page, page.getByText("PAUSED", { exact: true }), { ms: 900 });
  await sleep(5000);
  links.consoleAfter = await pageLinks(page);
  saveLinks();
  await rec2.finish();
}

if (phase === "why190") {
  // The inflated bill: the guard row for 190, not the duplicate 60 refusal.
  const page = await newPage();
  await page.goto(`${process.env.WHY_SITE || SITE}/console/${state.vault}`, { waitUntil: "networkidle" });
  await page.locator("ol li").nth(6).waitFor({ timeout: 90000 });
  await sleep(2500);
  const rec = await record(page, "why190");
  await sleep(1200);
  const row = page.locator("ol li details").filter({ hasText: "BLOCKED BY GUARD" }).filter({ hasText: /\b190\b/ }).first();
  rec.mark("open");
  await click(page, row.locator("summary"));
  await sleep(1000);
  await hover(page, row.getByText(/190 dUSDC|60 dUSDC|approved amount/).first(), { ms: 1000 }).catch(() => {});
  await sleep(6000);
  rec.mark("end");
  await rec.finish();
}

if (phase === "landing") {
  const page = await newPage();
  const rec = await record(page, "landing");
  await page.goto(SITE, { waitUntil: "networkidle" });
  rec.mark("loaded");
  await sleep(7000);
  await hover(page, page.getByText(/Attacker received/).first(), { ms: 1400 });
  await sleep(2500);
  rec.mark("scroll");
  const h = await page.evaluate(() => document.body.scrollHeight - innerHeight);
  for (let y = 0; y < h; y += 760) {
    await scrollBy(page, Math.min(760, h - y), 1300);
    await sleep(2200);
  }
  rec.mark("bottom");
  await scrollBy(page, -h, 2000);
  await sleep(2000);
  await rec.finish();
}

if (phase === "tests") {
  await terminal("tests", "pnpm test:fast");
}

if (phase === "check") {
  await terminal("check", `pnpm -s guard:reset-demo --vault ${state.vault}; pnpm -s demo:check --vault ${state.vault} --site ${SITE}`);
}

log("phase", phase, "done, burner", BURNER, "vault", state.vault ?? "-");
process.exit(0);
