// Shared recording toolkit: a Wallet Standard "Burner" wallet that signs in Node, an eased cursor
// with click ripples, a CDP screencast recorder (sharper than Playwright's 1 Mbit VP8), and marks.
import { chromium } from "playwright-core";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SITE = process.env.SITE || "https://leash-ruddy.vercel.app";
export const CLIPS = join(import.meta.dirname, "clips");
mkdirSync(CLIPS, { recursive: true });

const KEY = process.env.BURNER_KEY_FILE;
const burner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY, "utf8"))));
export const BURNER = burner.publicKey.toBase58();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function wsl(cmd, onLine) {
  return new Promise((resolve) => {
    const p = spawn("wsl", ["-d", "Ubuntu-24.04", "-u", "tushar", "bash", "-ic", `cd ~/projects/leash && ${cmd}`]);
    let out = "";
    let buf = "";
    const feed = (d) => {
      out += d;
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) onLine?.(l);
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("close", (code) => {
      if (buf) onLine?.(buf);
      resolve({ code, out });
    });
  });
}

const ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRkZCMDIwIi8+PC9zdmc+";

const walletScript = (pub, pubBytes, autoconnect) => `(() => {
  const ICON = ${JSON.stringify(ICON)};
  const CHAINS = ["solana:devnet", "solana:testnet", "solana:mainnet"];
  const account = Object.freeze({ address: ${JSON.stringify(pub)}, publicKey: new Uint8Array(${JSON.stringify(pubBytes)}),
    chains: CHAINS, features: ["solana:signTransaction"], label: "Burner", icon: ICON });
  let connected = false;
  const listeners = {};
  const emit = (ev, arg) => (listeners[ev] || []).forEach((f) => f(arg));
  const wallet = {
    version: "1.0.0", name: "Burner", icon: ICON, chains: CHAINS,
    get accounts() { return connected ? [account] : []; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { connected = true; emit("change", { accounts: [account] }); return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { connected = false; emit("change", { accounts: [] }); } },
      "standard:events": { version: "1.0.0", on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; } },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) => Promise.all(inputs.map(async ({ transaction }) =>
          ({ signedTransaction: new Uint8Array(await window.__burnerSign(Array.from(transaction))) }))) },
    },
  };
  const cb = ({ register }) => register(wallet);
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb })); } catch {}
  try { window.addEventListener("wallet-standard:app-ready", ({ detail }) => cb(detail)); } catch {}
  ${autoconnect ? `try { localStorage.setItem("walletName", JSON.stringify("Burner")); } catch {}` : `try { localStorage.removeItem("walletName"); } catch {}`}
})();`;

const cursorScript = (touch) => `(() => {
  const TOUCH = ${touch};
  const css = \`
    #__cur { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; will-change: transform;
      transform: translate(-100px, -100px); transition: opacity .2s; }
    #__cur svg { display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,.55)); }
    #__cur .dot { width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      background: rgba(255,255,255,.28); border: 2px solid rgba(255,255,255,.85); box-shadow: 0 2px 8px rgba(0,0,0,.5); }
    .__rip { position: fixed; z-index: 2147483646; pointer-events: none; width: 16px; height: 16px; margin: -8px 0 0 -8px;
      border-radius: 50%; border: 2px solid #6ee7a8; animation: __rip .6s ease-out forwards; }
    @keyframes __rip { from { transform: scale(1); opacity: .95; } to { transform: scale(4.5); opacity: 0; } }
    #__tick { position: fixed; right: 0; bottom: 0; width: 2px; height: 2px; z-index: 2147483647; pointer-events: none;
      animation: __tk 1s steps(60) infinite; }
    @keyframes __tk { from { opacity: .01 } to { opacity: .02 } }\`;
  const mount = () => {
    if (document.getElementById("__cur")) return;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement("div"); c.id = "__cur";
    c.innerHTML = TOUCH ? '<div class="dot"></div>' :
      '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.2 28 L16 26.4 L11.9 17 L20 17 Z" fill="#fff" stroke="#0b0d0c" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const t = document.createElement("div"); t.id = "__tick"; document.body.appendChild(t);
    const p = window.__curPos; if (p) c.style.transform = \`translate(\${p[0]}px, \${p[1]}px)\`;
  };
  addEventListener("mousemove", (e) => {
    window.__curPos = [e.clientX, e.clientY];
    if (document.body && !document.getElementById("__cur")) mount();
    const c = document.getElementById("__cur"); if (c) c.style.transform = \`translate(\${e.clientX}px, \${e.clientY}px)\`;
  }, true);
  addEventListener("mousedown", (e) => {
    const r = document.createElement("div"); r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
    document.body.appendChild(r); setTimeout(() => r.remove(), 700);
  }, true);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount); else mount();
})();`;

let browser;
export async function openBrowser() {
  browser ??= await chromium.launch({ channel: "chrome", args: ["--hide-scrollbars"] });
  return browser;
}

/** A page with the burner wallet and the cursor. phone: 390x844 at 2x, touch cursor. */
export async function newPage({ phone = false, autoconnect = true } = {}) {
  const b = await openBrowser();
  const ctx = await b.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    deviceScaleFactor: phone ? 2 : 1,
    isMobile: phone,
    hasTouch: false,
    colorScheme: "dark",
  });
  await ctx.exposeFunction("__burnerSign", (bytes) => {
    const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
    tx.sign([burner]);
    log("signed a transaction with the burner");
    return Array.from(tx.serialize());
  });
  await ctx.addInitScript(walletScript(BURNER, Array.from(burner.publicKey.toBytes()), autoconnect));
  await ctx.addInitScript(cursorScript(phone));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("PAGEERROR", e.message));
  page.on("console", (m) => m.type() === "error" && log("CONSOLE", m.text().slice(0, 200)));
  page.__pos = phone ? [195, 600] : [960, 700];
  return page;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Moves the visible cursor along an eased path. */
export async function moveTo(page, x, y, ms) {
  const [x0, y0] = page.__pos;
  const dist = Math.hypot(x - x0, y - y0);
  ms ??= Math.min(1100, Math.max(350, dist * 0.9));
  const steps = Math.max(8, Math.round(ms / 16));
  const start = Date.now();
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    await page.mouse.move(x0 + (x - x0) * t, y0 + (y - y0) * t);
    const due = start + (ms * i) / steps;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
  }
  page.__pos = [x, y];
}

export async function hover(page, locator, { dx = 0.5, dy = 0.5, ms } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for hover");
  await moveTo(page, box.x + box.width * dx, box.y + box.height * dy, ms);
}

export async function click(page, locator, opts = {}) {
  await locator.waitFor({ state: "visible", timeout: opts.timeout ?? 60000 });
  await hover(page, locator, opts);
  await sleep(opts.pause ?? 220);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await sleep(250);
}

/** Smooth scroll by dy pixels over ms. */
export async function scrollBy(page, dy, ms = 1200) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise((res) => {
        const y0 = scrollY;
        const t0 = performance.now();
        const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          scrollTo(0, y0 + dy * e(t));
          t < 1 ? requestAnimationFrame(step) : res();
        };
        requestAnimationFrame(step);
      }),
    [dy, ms]
  );
}

export async function until(page, fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await page.waitForTimeout(700);
  }
  throw new Error(`timeout: ${what}`);
}

let logFile;
export function log(...a) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  if (logFile) appendFileSync(logFile, line + "\n");
}
export const setLog = (f) => (logFile = f);

/** CDP screencast recorder. Frames land as JPEGs with timestamps; finish() encodes an mp4. */
export async function record(page, name) {
  const dir = join(CLIPS, `${name}-frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const vp = page.viewportSize();
  const dpr = await page.evaluate(() => devicePixelRatio);
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const marks = [];
  let n = 0;
  let stopped = false;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    if (stopped) return;
    const file = `f${String(++n).padStart(6, "0")}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const start = async () =>
    cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: vp.width * dpr,
      maxHeight: vp.height * dpr,
      everyNthFrame: 1,
    });
  await start();
  const t0 = Date.now() / 1000;
  page.on("framenavigated", (f) => !stopped && f === page.mainFrame() && start().catch(() => {}));
  return {
    t0,
    mark(label, extra = {}) {
      const t = +(Date.now() / 1000 - t0).toFixed(2);
      marks.push({ label, t, ...extra });
      log(`mark ${name}:${label} @${t}s`);
    },
    async finish() {
      stopped = true;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.detach().catch(() => {});
      await sleep(300);
      // Concat list with real durations, then a constant 30 fps H.264.
      let list = "";
      for (let i = 0; i < frames.length; i++) {
        const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.5;
        list += `file '${frames[i].file}'\nduration ${Math.max(0.001, d).toFixed(4)}\n`;
      }
      list += `file '${frames.at(-1).file}'\n`;
      writeFileSync(join(dir, "list.txt"), list);
      const lead = frames[0].t - t0; // seconds of nothing before the first frame
      const out = join(CLIPS, `${name}.mp4`);
      const w = vp.width * dpr;
      const h = vp.height * dpr;
      execFileSync(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
          "-vf", `scale=${w}:${h}:flags=lanczos,tpad=start_duration=${Math.max(0, lead).toFixed(3)}:start_mode=clone,fps=30,format=yuv420p`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", out],
        { stdio: "inherit" }
      );
      writeFileSync(join(CLIPS, `${name}.json`), JSON.stringify({ name, width: w, height: h, frames: frames.length, marks }, null, 2));
      rmSync(dir, { recursive: true, force: true });
      log(`wrote ${out} (${frames.length} frames)`);
    },
  };
}

export const saveJson = (file, data) => writeFileSync(join(CLIPS, file), JSON.stringify(data, null, 2));
export const loadJson = (file, dflt) =>
  existsSync(join(CLIPS, file)) ? JSON.parse(readFileSync(join(CLIPS, file), "utf8")) : dflt;
