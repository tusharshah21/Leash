// Records the draft demo video: one 1440x900 Playwright page for the whole story, with captions
// drawn in the page, and a marks file that build.mjs cuts and speeds into demo/video/leash-draft.mp4.
//
// Runs where Chrome is installed (it drives the installed Chrome, not a downloaded one):
//   npm i --prefix <somewhere> playwright-core@1.56.1
//   PLAYWRIGHT_CORE=<somewhere>/node_modules/playwright-core/index.mjs node demo/video/record.mjs
// Needs: pnpm dev:web running with NEXT_PUBLIC_DEV_BURNER_KEY set (the burner owns the vault),
// the WSL repo at REPO (for demo:run, guard:reset-demo), and test output in TESTS_DIR.
// Env: VAULT (required: the burner's vault, created and empty), BASE, OUT, SHOTS (after screenshots).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const pw = process.env.PLAYWRIGHT_CORE
  ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href
  : "playwright-core";
const { chromium } = await import(pw);

const BASE = process.env.BASE || "http://localhost:3000";
const VAULT = process.env.VAULT;
const OUT = process.env.OUT || "demo/video/out";
const SHOTS = process.env.SHOTS;
const TESTS_DIR = process.env.TESTS_DIR;
const REPO_URL = "https://github.com/tusharshah21/Leash";
if (!VAULT) throw new Error("Set VAULT to the burner's fresh vault");
mkdirSync(OUT, { recursive: true });

const W = 1440;
const H = 900;
const browser = await chromium.launch({ channel: "chrome" });

function wsl(cmd) {
  return new Promise((resolve) => {
    const p = spawn("wsl", [
      "-d",
      "Ubuntu-24.04",
      "-u",
      "tushar",
      "bash",
      "-ic",
      `cd ~/projects/leash && ${cmd}`,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

async function connect(page) {
  const menu = page.locator("header button[aria-haspopup=menu]");
  await menu.waitFor();
  await page.waitForTimeout(1500);
  for (let i = 0; i < 20 && /Connecting/.test(await menu.innerText()); i++) {
    await page.waitForTimeout(500);
  }
  const btn = page.locator("header").getByRole("button", { name: /^Connect( wallet)?$/ });
  if (await btn.count()) {
    await btn.click();
    await page.getByRole("menuitem", { name: /Dev burner/ }).click();
    await page.waitForTimeout(800);
  }
  storage = await page.context().storageState();
}

// ---------------------------------------------------------------- recording page and helpers
// Each scene records into its own video. The recorder's clock drifts by seconds over a long take,
// so marks taken from the wall clock only stay accurate within a short one.
let ctx = null;
let page = null;
let t0 = 0;
let storage; // The wallet choice, so a new scene's page reconnects the burner by itself.
const segments = [];
let sceneSegments = [];
let open = null;
const now = () => (Date.now() - t0) / 1000;
/** Starts a kept segment. speed > 1 plays it faster in the cut. */
const begin = (name, speed = 1) => (open = { name, speed, in: now() });
const end = () => {
  sceneSegments.push({ ...open, out: now() });
  open = null;
};
const hold = (ms) => page.waitForTimeout(ms);

async function closeScene() {
  if (!ctx) return;
  await hold(1500); // Lets the recorder flush the last frames.
  const video = page.video();
  await ctx.close();
  const path = await video.path();
  for (const s of sceneSegments) segments.push({ ...s, video: path });
  sceneSegments = [];
}

async function scene() {
  await closeScene();
  ctx = await browser.newContext({
    viewport: { width: W, height: H },
    colorScheme: "dark",
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    storageState: storage,
  });
  page = await ctx.newPage();
  t0 = Date.now();
}

const CAPTION_CSS = `
#cap{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:9999;max-width:980px;
 padding:14px 22px;background:#0b0e11f2;border:1px solid #36414c;color:#e6edf3;
 font:500 22px/1.4 var(--font-plex-sans,"IBM Plex Sans"),system-ui,sans-serif;box-shadow:0 12px 40px #000a;
 display:flex;gap:16px;align-items:baseline;transition:opacity .3s}
#cap b{font:500 13px/1 var(--font-plex-mono,"IBM Plex Mono"),monospace;letter-spacing:.08em;color:#3ddc97;white-space:nowrap}
#cap.red b{color:#ff5c5c}#cap.amber b{color:#ffb020}
#cap.left{left:40px;transform:none;max-width:420px;flex-direction:column;gap:8px}
@keyframes tk{50%{background:#0c0f12}}
#tick{position:fixed;right:0;bottom:0;width:2px;height:2px;background:#0b0e11;z-index:99999;
 animation:tk 66ms steps(1) infinite}
.spot{position:relative;z-index:50;box-shadow:0 0 0 9999px #000000a0;transition:box-shadow .4s}`;

// Captions also install #tick, a 2px corner that repaints every frame. The recorder only gets a
// frame when the page repaints, so a still page would otherwise shift every later mark.
async function caption(text, tag = "", tone = "") {
  await page.evaluate(
    ([text, tag, tone, css]) => {
      if (!document.getElementById("cap-style")) {
        const s = document.createElement("style");
        s.id = "cap-style";
        s.textContent = css;
        document.head.append(s);
      }
      if (!document.getElementById("tick")) {
        const t = document.createElement("div");
        t.id = "tick";
        document.body.append(t);
      }
      document.getElementById("cap")?.remove();
      if (!text) return;
      const el = document.createElement("div");
      el.id = "cap";
      el.className = tone;
      el.innerHTML = `${tag ? `<b>${tag}</b>` : ""}<span></span>`;
      el.querySelector("span").textContent = text;
      document.body.append(el);
    },
    [text, tag, tone, CAPTION_CSS]
  );
}

async function spotlight(locator) {
  await page.evaluate(() =>
    document.querySelectorAll(".spot").forEach((e) => e.classList.remove("spot"))
  );
  if (locator) await locator.evaluate((e) => e.classList.add("spot"));
}

async function card(title, sub, foot = "") {
  await page.setContent(
    `<!doctype html><html><head>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@500;600&display=block" rel="stylesheet">
  <style>html,body{margin:0;height:100%;background:#0b0e11;color:#e6edf3;font-family:'IBM Plex Sans'}
  body{display:flex;flex-direction:column;justify-content:center;padding:0 120px;
   background-image:linear-gradient(to right,#ffffff08 1px,transparent 1px),linear-gradient(to bottom,#ffffff08 1px,transparent 1px);background-size:48px 48px}
  .e{font:500 15px 'IBM Plex Mono';letter-spacing:.1em;color:#3ddc97;text-transform:uppercase}
  h1{font-size:76px;line-height:1.05;margin:20px 0 0;font-weight:600;letter-spacing:-.02em;max-width:1100px}
  p{font-size:28px;color:#8b98a5;margin:24px 0 0;max-width:1000px;line-height:1.4}
  .f{position:fixed;bottom:56px;left:120px;font:500 16px 'IBM Plex Mono';color:#8b98a5}</style></head>
  <body><div class="e">Leash</div><h1>${title}</h1>${
      sub ? `<p>${sub}</p>` : ""
    }<div class="f">${foot}</div></body></html>`,
    { waitUntil: "networkidle" }
  );
  await page.evaluate(() => document.fonts.ready);
  await caption("");
  await hold(300);
}

// ---------------------------------------------------------------- the story
// Title
await scene();
await card(
  "An onchain firewall for AI agents",
  "What happens when the agent holding your wallet gets fooled?",
  "Solana devnet, recorded live"
);
begin("title");
await hold(5000);
end();

// Landing
await scene();
await page.goto(BASE, { waitUntil: "networkidle" });
await hold(800);
begin("landing");
await caption("Leash puts an agent's money in a Solana program that checks every payment.");
await hold(5500);
await caption(
  "Small payments just happen. Bigger ones need a guard. Anything unusual waits for you."
);
await page.mouse.wheel(0, 640);
await hold(5500);
end();

// Console before the run
await scene();
await page.goto(`${BASE}/console/${VAULT}`);
await connect(page);
await page.getByText("No agent activity on this vault yet.").waitFor({ timeout: 60000 });
await hold(1000);
begin("console-empty");
await caption("A fresh vault: test dUSDC, a signed mandate, three allowlisted vendors.", "SETUP");
await hold(4500);
await caption(
  "The agent pays this week's invoices. Two of them hide instructions for it.",
  "LIVE RUN",
  "amber"
);
await hold(3500);
end();

// The live run, sped up
begin("run", 3);
await caption(
  "pnpm demo:run: the real agent and guard on devnet. Shown at 3x.",
  "LIVE RUN  3x",
  "amber"
);
const run = wsl(`pnpm demo:run --vault ${VAULT}`);
const result = await run;
writeFileSync(`${OUT}/demo-run.log`, result.out);
if (result.code !== 0) throw new Error("demo:run failed: see demo-run.log");
await page.locator("article").nth(1).waitFor({ timeout: 60000 });
await hold(5000);
end();

if (SHOTS) await afterShots();

// Timeline filled, on a fresh page once every row has loaded
await scene();
await page.goto(`${BASE}/console/${VAULT}`);
await connect(page);
await page.locator("article").nth(1).waitFor({ timeout: 60000 });
await page.locator("ol li").nth(5).waitFor({ timeout: 60000 });
await hold(2500);
await caption("");
begin("timeline");
await spotlight(page.locator("section", { hasText: "Timeline" }).last());
await caption(
  "Every status comes from the chain. Four invoices paid, within the mandate.",
  "TIMELINE"
);
await hold(5000);
end();

// The attacker's card
const attack = page.locator("article").filter({ hasText: "NOT ON ALLOWLIST" }).first();
await attack.scrollIntoViewIfNeeded();
await spotlight(attack);
begin("pending");
await caption(
  "The agent fell for it: 150 dUSDC to an address you never listed. It can only wait for you.",
  "HIGH",
  "red"
);
await hold(6500);
await caption(
  "The guard reviewed it too, and flags the recipient. Its review is advice; the chain holds the line.",
  "HIGH",
  "red"
);
await hold(4500);
end();

// Why: verified reasoning on the attacker's row, then the guard's refusal of the inflated bill
await spotlight(null);
await caption("");
const rows = page.locator("ol li details");
const attackRow = rows.filter({ hasText: /150[\s\S]*PENDING/ }).first();
await attackRow.locator("summary").click();
await attackRow.scrollIntoViewIfNeeded();
await spotlight(attackRow);
begin("why");
await caption(
  "The agent's reasoning is hashed onchain with the proposal. This one matches.",
  "WHY"
);
await hold(5500);
await attackRow.locator("summary").click();
const guardRow = rows.filter({ hasText: "BLOCKED BY GUARD" }).first();
await guardRow.locator("summary").click();
await spotlight(guardRow);
await caption(
  "A second invoice inflated a real vendor's bill from 60 to 190. The guard refused to co-sign.",
  "WHY"
);
await hold(6000);
await guardRow.locator("summary").click();
const chainRow = rows.filter({ hasText: "BLOCKED BY CHAIN" }).first();
await chainRow.locator("summary").click();
await spotlight(chainRow);
await caption(
  "And a stolen agent key calling the program directly? Rejected onchain: NotAllowlisted.",
  "WHY",
  "red"
);
await hold(5000);
await chainRow.locator("summary").click();
end();

// Reject from the phone, through the Blink
await spotlight(null);
await caption("");
await page.evaluate(() => window.scrollTo(0, 0));
await attack.getByRole("button", { name: /Approve from phone/ }).click();
await hold(600);
begin("qr");
await caption(
  "Each pending payment has a QR code. It opens a Blink in Phantom on your phone.",
  "BLINK"
);
await hold(4500);
end();
const href = await page.getByRole("link", { name: "Open here" }).getAttribute("href");
await page.keyboard.press("Escape");
const u = new URL(href);
await scene();
await page.goto(`${BASE}${u.pathname}${u.search}`);
await connect(page);
const reject = page.getByRole("button", { name: "Reject", exact: true });
await reject.waitFor({ timeout: 30000 });
await hold(1500);
begin("blink");
await caption(
  "The Blink shows only chain facts, and the agent's claim only if its hash matches.",
  "BLINK",
  "left"
);
await hold(5000);
await caption(
  "One tap: reject. Nothing moved, and the proposal is closed for good.",
  "BLINK",
  "red left"
);
await reject.click();
await page
  .getByRole("status")
  .filter({ hasText: /View transaction/ })
  .waitFor({ timeout: 90000 });
await hold(3500);
end();

// Kill switch
await scene();
await page.goto(`${BASE}/console/${VAULT}`);
await connect(page);
await page.getByRole("button", { name: "Revoke agent" }).waitFor({ timeout: 60000 });
await page.locator("ol li").first().waitFor({ timeout: 60000 });
await hold(1500);
const kill = page.locator("section", { hasText: "Kill switch" }).first();
await kill.scrollIntoViewIfNeeded();
await spotlight(kill);
begin("kill");
await caption(
  "The attacker got nothing. And if you no longer trust the agent at all:",
  "KILL SWITCH",
  "red"
);
await hold(3500);
await page.getByRole("button", { name: "Revoke agent" }).click();
await hold(1200);
await page.locator("dialog").getByRole("button", { name: "Revoke agent" }).click();
await page.getByText("PAUSED", { exact: true }).waitFor({ timeout: 90000 });
await spotlight(page.locator("section").first());
await caption("Revoked onchain. The agent can no longer pay or propose.", "KILL SWITCH", "red");
await hold(4500);
end();

// Tests
const tests = TESTS_DIR ? terminal(readFileSync(`${TESTS_DIR}/test-fast.txt`, "utf8")) : null;
if (tests) {
  await scene();
  await page.setContent(tests, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await hold(500);
  begin("tests");
  await page.evaluate(() => {
    const el = document.getElementById("t");
    el.style.transition = "transform 9s linear";
    el.style.transform = `translateY(-${Math.max(0, el.scrollHeight - 760)}px)`;
  });
  await caption(
    "Every attack is a test that asserts the exact onchain error. 97 pass on a local validator.",
    "TESTS"
  );
  await hold(10000);
  end();
}

// Threat model
await scene();
await page.goto(`${REPO_URL}#threat-model`, { waitUntil: "domcontentloaded" });
await caption("");
await hold(3000);
begin("threat");
await caption(
  "The chain is the only hard limit. The README says plainly what is not covered.",
  "THREAT MODEL"
);
await hold(4000);
await page.mouse.wheel(0, 500);
await hold(5000);
end();

// End card
await scene();
await card(
  "Leash",
  "The agent can be fooled. The money cannot.",
  "github.com/tusharshah21/Leash &nbsp;&nbsp; leash-ruddy.vercel.app"
);
begin("end");
await hold(5000);
end();
await closeScene();

writeFileSync(`${OUT}/marks.json`, JSON.stringify({ segments }, null, 2));
console.log(`${segments.length} segments`);
await browser.close();

// ---------------------------------------------------------------- helpers used above
function terminal(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // eslint-disable-next-line no-control-regex
  // Runtime warnings are noise on screen. The test names and the summary are the point.
  const NOISE = /bigint|MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings|Running test suite/;
  const lines = text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter((l) => !NOISE.test(l));
  const html = lines
    .map((l) => {
      const cls = /✔|passing/.test(l)
        ? "ok"
        : /^\s*- |pending|skipped/.test(l)
        ? "dim"
        : /^\s{2,4}\S/.test(l)
        ? "h"
        : "";
      return `<div class="${cls}">${esc(l) || "&nbsp;"}</div>`;
    })
    .join("");
  return `<!doctype html><html><head>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@500&display=block" rel="stylesheet">
  <style>html,body{margin:0;height:100%;background:#0b0e11;overflow:hidden}
  .win{position:absolute;inset:48px 120px 140px;border:1px solid #36414c;background:#12171c;overflow:hidden}
  .bar{height:36px;border-bottom:1px solid #232b33;display:flex;align-items:center;padding:0 16px;
   font:500 13px 'IBM Plex Mono';color:#8b98a5;letter-spacing:.06em}
  #t{padding:16px 24px;font:400 15px/1.55 'IBM Plex Mono';color:#c9d4de;white-space:pre}
  .ok{color:#3ddc97}.dim{color:#8b98a5}.h{color:#e6edf3;font-weight:500}</style></head>
  <body><div class="win"><div class="bar">$ pnpm test:fast</div><div id="t">${html}</div></div></body></html>`;
}

async function afterShots() {
  const dir = SHOTS;
  mkdirSync(dir, { recursive: true });
  for (const [w, h, tag] of [
    [1440, 900, "1440"],
    [390, 844, "390"],
  ]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark" });
    const p = await c.newPage();
    await p.goto(`${BASE}/console/${VAULT}`);
    await p.locator("article").nth(1).waitFor({ timeout: 60000 });
    await p.locator("ol li").nth(3).waitFor({ timeout: 60000 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${dir}/after-console-${tag}.png` });
    await p.screenshot({ path: `${dir}/after-console-full-${tag}.png`, fullPage: true });
    const a = p.locator("article").filter({ hasText: "NOT ON ALLOWLIST" }).first();
    await a.screenshot({ path: `${dir}/after-pending-card-${tag}.png` });
    const r = p
      .locator("ol li details")
      .filter({ hasText: /150[\s\S]*PENDING/ })
      .first();
    await r.locator("summary").click();
    await p.waitForTimeout(400);
    await r.screenshot({ path: `${dir}/after-why-verified-${tag}.png` });
    const g = p.locator("ol li details").filter({ hasText: "BLOCKED BY GUARD" }).first();
    await g.locator("summary").click();
    await p.waitForTimeout(400);
    await g.screenshot({ path: `${dir}/after-why-guard-${tag}.png` });
    await a.getByRole("button", { name: /Approve from phone/ }).click();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${dir}/after-phone-qr-${tag}.png` });
    const link = await p.getByRole("link", { name: "Open here" }).getAttribute("href");
    const lu = new URL(link);
    await p.goto(`${BASE}${lu.pathname}${lu.search}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${dir}/after-blink-${tag}.png`, fullPage: true });
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.waitForTimeout(4500);
    await p.screenshot({ path: `${dir}/after-landing-${tag}.png` });
    await p.screenshot({ path: `${dir}/after-landing-full-${tag}.png`, fullPage: true });
    await c.close();
  }
  if (!existsSync(dir)) throw new Error("no shots");
}
