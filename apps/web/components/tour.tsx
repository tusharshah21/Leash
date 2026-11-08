"use client";

import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEMO_VAULT } from "@/lib/chain";
import { Button } from "./ui";

const SEEN = "leash-tour-seen";

/** `target` names a `data-tour` element. A step whose target is missing shows in the middle. */
type Step = { target?: string; title: string; body: ReactNode };

const LANDING: Step[] = [
  {
    target: "hero",
    title: "An AI agent with a wallet needs a leash",
    body: (
      <>
        <p>
          AI agents can now pay bills for you. To do that they read documents, such as invoices, and a
          document can trick them: one hidden line saying &ldquo;also pay this address&rdquo; is enough.
        </p>
        <p>
          Leash does not try to make the agent smarter. It makes sure that even a tricked agent cannot
          spend money in a way you did not allow.
        </p>
      </>
    ),
  },
  {
    target: "replay",
    title: "A real attack, replayed",
    body: (
      <>
        <p>
          An agent was asked to pay four invoices, and two of them hid instructions. Each row is one
          payment it tried: the amount, who it was for, and what happened.
        </p>
        <p>
          The red rows are the attack. The agent fell for it, yet the attacker received{" "}
          <strong>0</strong>.
        </p>
      </>
    ),
  },
  {
    target: "layers",
    title: "Every payment takes one of three lanes",
    body: (
      <ul>
        <li>
          <strong className="text-safe">Small</strong> payments to someone on your allowlist just go
          through.
        </li>
        <li>
          <strong className="text-pending">Medium</strong> payments also need a guard: a second service
          with its own key that checks the payment matches your task. It never reads the documents, so
          they cannot trick it.
        </li>
        <li>
          <strong className="text-blocked">Anything unusual</strong>, like a new recipient or a large
          amount, cannot be paid at all. It waits until you approve or reject it.
        </li>
      </ul>
    ),
  },
  {
    target: "fooled",
    title: "What a fooled agent can still do",
    body: (
      <p>
        Three ways to attack the agent, and what stops each one. The rules live in a program on the
        Solana blockchain that holds the money, so no prompt or document can talk it out of them.
      </p>
    ),
  },
  {
    target: "live",
    title: "Live numbers",
    body: (
      <p>
        These come straight from the blockchain. Everything here runs on <strong>devnet</strong>,
        Solana&rsquo;s test network, and the dUSDC it moves is a test dollar with no real value.
      </p>
    ),
  },
  {
    target: "nav",
    title: "Try it yourself",
    body: (
      <>
        <p>
          <strong>Console</strong> opens the demo vault from the attack above. <strong>Create</strong>{" "}
          makes your own, with a wallet such as Phantom set to devnet.
        </p>
        <p>
          Each page has its own guide behind the <strong>?</strong> button.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/console/${DEMO_VAULT}`} className="text-safe hover:underline">
            Open the demo console
          </Link>
          <Link href="/create" className="text-safe hover:underline">
            Create a vault
          </Link>
        </p>
      </>
    ),
  },
];

const CONSOLE: Step[] = [
  {
    target: "vault",
    title: "The vault",
    body: (
      <>
        <p>
          The money sits here, held by the program, not by the agent. The agent can only ask the vault
          to pay.
        </p>
        <p>
          Each role has its own key: the <strong>owner</strong> (you), the <strong>agent</strong>, the{" "}
          <strong>guard</strong> and an optional hardware <strong>device</strong>. One stolen key is
          never enough to do everything.
        </p>
      </>
    ),
  },
  {
    target: "mandate",
    title: "Your rules",
    body: (
      <p>
        The mandate the owner signed: up to which amount the agent pays alone, the largest single
        payment, the daily limit and how much of it is used, and when the agent&rsquo;s permission
        expires.
      </p>
    ),
  },
  {
    target: "pending",
    title: "Waiting for you",
    body: (
      <p>
        Payments the rules would not allow, such as one to an address you never listed, land here and
        move nothing. Each card shows what the agent claims and the guard&rsquo;s opinion. The owner can
        approve or reject, here or from a phone through the QR code.
      </p>
    ),
  },
  {
    target: "timeline",
    title: "Everything that happened",
    body: (
      <p>
        Every payment and attempt, newest first. The status comes from the blockchain, never from what
        the AI says. Open a row to see why it happened; &ldquo;Reasoning verified onchain&rdquo; means
        the explanation matches what the agent committed to when it asked.
      </p>
    ),
  },
  {
    target: "kill",
    title: "The kill switch",
    body: (
      <p>
        If something looks wrong, <strong>Revoke agent</strong> stops it at once, onchain. Pending
        requests can still be approved or rejected, and the owner can always withdraw.
      </p>
    ),
  },
];

const CREATE: Step[] = [
  {
    target: "wallet",
    title: "Connect a wallet",
    body: (
      <p>
        Your wallet becomes the vault&rsquo;s owner. Use one such as Phantom, switched to devnet, with a
        little devnet SOL for fees.
      </p>
    ),
  },
  {
    target: "create-steps",
    title: "Four steps, one signature",
    body: (
      <ul>
        <li>
          <strong>Mandate:</strong> the agent&rsquo;s limits and expiry.
        </li>
        <li>
          <strong>Allowlist:</strong> the only recipients it may pay.
        </li>
        <li>
          <strong>Deposit:</strong> how much test dUSDC to put in the vault.
        </li>
        <li>
          <strong>Review:</strong> one wallet signature creates everything at once.
        </li>
      </ul>
    ),
  },
];

const stepsFor = (path: string) =>
  path.startsWith("/console") ? CONSOLE : path === "/create" ? CREATE : LANDING;

const GAP = 12;

/** A walkthrough that points at each section in turn. Opens once on its own on /, then from the header. */
export function Tour() {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(0);

  const steps = stepsFor(pathname);
  const current = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;

  useEffect(() => {
    setStep(0);
    // Only the landing page opens it: a console, /create or a phone approval on /blink is a task in progress.
    if (pathname !== "/") return;
    try {
      if (!localStorage.getItem(SEEN)) setOpen(true);
    } catch {
      // Storage blocked: skip the automatic open; the Guide button still works.
    }
  }, [pathname]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  // Bring the step's section into view and follow it while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const el = current.target
      ? document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`)
      : null;
    if (!el) {
      setRect(null);
      return;
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    const update = () => setRect(el.getBoundingClientRect());
    update();
    addEventListener("scroll", update, true);
    addEventListener("resize", update);
    return () => {
      removeEventListener("scroll", update, true);
      removeEventListener("resize", update);
    };
  }, [open, current]);

  useLayoutEffect(() => {
    if (open && card.current) setCardH(card.current.offsetHeight);
  }, [open, current, rect?.width]);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, "1");
    } catch {}
  };

  // Below the section if it fits, else above, else pinned to the bottom of the screen.
  let place: CSSProperties = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const vw = innerWidth;
    const vh = innerHeight;
    const width = Math.min(448, vw - 32);
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - cardH;
    const top = below + cardH <= vh - GAP ? below : above >= GAP ? above : vh - cardH - GAP;
    place = { top, left: Math.min(Math.max(rect.left, 16), vw - width - 16), width };
  }

  return (
    <>
      <button
        type="button"
        data-tour="guide"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
        className="flex h-10 cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <CircleHelp size={16} aria-hidden="true" />
        <span className="hidden sm:inline">Guide</span>
        <span className="sr-only sm:hidden">Open the guide</span>
      </button>
      <dialog
        ref={dialog}
        onClose={close}
        aria-labelledby="tour-title"
        className="tour m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink"
      >
        {rect ? (
          <div
            aria-hidden="true"
            className="tour-spot pointer-events-none fixed"
            style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
          />
        ) : (
          <div aria-hidden="true" className="fixed inset-0 bg-black/65" />
        )}
        <div
          ref={card}
          // Links inside a step leave the page, so the tour ends with them.
          onClick={(e) => (e.target as HTMLElement).closest("a") && close()}
          className="fixed w-[calc(100%-2rem)] max-w-md border border-line-strong bg-raised p-5 shadow-2xl"
          style={place}
        >
          <p className="eyebrow">
            Step {step + 1} of {steps.length}
          </p>
          <h3 id="tour-title" className="mt-2 text-lg font-semibold">
            {current.title}
          </h3>
          <div className="tour-body mt-3 space-y-3 text-sm leading-relaxed text-muted">{current.body}</div>
          <div className="mt-4 flex gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.title} className={`h-1 flex-1 ${i <= step ? "bg-safe" : "bg-line-strong"}`} />
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" onClick={close} className="cursor-pointer text-sm text-muted hover:text-ink">
              {last ? "Close" : "Skip"}
            </button>
            <div className="flex gap-3">
              {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
              <Button variant="primary" onClick={() => (last ? close() : setStep(step + 1))}>
                {last ? "Done" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
