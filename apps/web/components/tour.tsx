"use client";

import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DEMO_VAULT } from "@/lib/chain";
import { Button } from "./ui";

const SEEN = "leash-tour-seen";

const STEPS: { title: string; body: ReactNode }[] = [
  {
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
    title: "Your money sits in a vault, not with the agent",
    body: (
      <>
        <p>
          The funds live in a vault on the Solana blockchain. The agent can only <em>ask</em> the vault to
          pay. A program on the blockchain checks every request and says yes or no, and no prompt or
          document can talk it out of its rules.
        </p>
        <p>
          This site runs on <strong>devnet</strong>, Solana&rsquo;s test network. The dUSDC here is a test
          dollar with no real value.
        </p>
      </>
    ),
  },
  {
    title: "You write the rules once",
    body: (
      <>
        <p>When you create a vault, you sign a mandate, the agent&rsquo;s permission slip:</p>
        <ul>
          <li>
            <strong>Allowlist:</strong> the only people it may pay.
          </li>
          <li>
            <strong>Limits:</strong> how much per payment, per recipient and per day.
          </li>
          <li>
            <strong>Expiry:</strong> when its permission runs out.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Every payment takes one of three lanes",
    body: (
      <ul>
        <li>
          <strong className="text-safe">Small</strong> payments to someone on your allowlist just go
          through.
        </li>
        <li>
          <strong className="text-pending">Medium</strong> payments also need a guard: a second service
          with its own key that checks the payment matches the task you gave. It never reads the
          documents, so they cannot trick it.
        </li>
        <li>
          <strong className="text-blocked">Anything unusual</strong>, like a new recipient or a large
          amount, cannot be paid at all. It waits as a request until you approve or reject it.
        </li>
      </ul>
    ),
  },
  {
    title: "You stay in control",
    body: (
      <>
        <p>
          The console shows every payment and why it happened. Statuses come from the blockchain, never
          from what the AI says about itself.
        </p>
        <p>
          Waiting requests have Approve and Reject buttons, and a QR code to decide from your phone. If
          something looks wrong, <strong>Revoke agent</strong> pauses everything in one step.
        </p>
      </>
    ),
  },
  {
    title: "Try it",
    body: (
      <>
        <p>
          The demo console shows a real run: an agent paying invoices was tricked into paying an
          attacker 150 dUSDC. The payment could only wait for the owner&rsquo;s approval, and the attacker
          received 0.
        </p>
        <p>
          To make your own vault you need a Solana wallet such as Phantom, switched to devnet. You can
          reopen this guide any time from the <strong>?</strong> button at the top.
        </p>
      </>
    ),
  },
];

/** A short walkthrough for first-time visitors. Opens once on its own, then from the header. */
export function Tour() {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Only the landing page opens it: a console, /create or a phone approval on /blink is a task in progress.
    if (pathname !== "/") return;
    try {
      if (!localStorage.getItem(SEEN)) setOpen(true);
    } catch {
      // Storage blocked: skip the automatic open; the Guide button still works.
    }
  }, [pathname]);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, "1");
    } catch {}
  };

  const last = step === STEPS.length - 1;

  return (
    <>
      <button
        type="button"
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
        ref={ref}
        onClose={close}
        aria-labelledby="tour-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg border border-line-strong bg-raised p-6 text-ink"
      >
        <p className="eyebrow">
          Step {step + 1} of {STEPS.length}
        </p>
        <h3 id="tour-title" className="mt-2 text-lg font-semibold">
          {STEPS[step].title}
        </h3>
        <div className="tour-body mt-3 space-y-3 text-sm leading-relaxed text-muted">
          {STEPS[step].body}
        </div>
        <div className="mt-5 flex gap-1.5" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.title} className={`h-1 flex-1 ${i <= step ? "bg-safe" : "bg-line-strong"}`} />
          ))}
        </div>
        {last && (
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={`/console/${DEMO_VAULT}`} onClick={close} className="text-sm text-safe hover:underline">
              Open the demo console
            </Link>
            <Link href="/create" onClick={close} className="text-sm text-safe hover:underline">
              Create a vault
            </Link>
          </div>
        )}
        <div className="mt-6 flex items-center justify-between gap-3">
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
      </dialog>
    </>
  );
}
