"use client";

import { describeError } from "@leash/sdk";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  ShieldX,
  TimerOff,
  XCircle,
} from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { addressUrl, short } from "@/lib/chain";
import type { Outcome } from "@/lib/timeline";

export function Card({
  title,
  aside,
  children,
  className = "",
  tour,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** An anchor for the guided tour. */
  tour?: string;
}) {
  return (
    <section data-tour={tour} className={`border border-line bg-surface ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="eyebrow">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

const OUTCOMES: Record<Outcome, { icon: typeof Clock; className: string }> = {
  PAID: { icon: CheckCircle2, className: "text-safe bg-safe-dim border-safe/40" },
  PENDING: { icon: Clock, className: "text-pending bg-pending-dim border-pending/40" },
  EXPIRED: { icon: TimerOff, className: "text-muted bg-raised border-line-strong" },
  REJECTED: { icon: Ban, className: "text-muted bg-raised border-line-strong" },
  "BLOCKED BY CHAIN": { icon: ShieldX, className: "text-blocked bg-blocked-dim border-blocked/40" },
  "BLOCKED BY GUARD": { icon: ShieldX, className: "text-blocked bg-blocked-dim border-blocked/40" },
  FAILED: { icon: XCircle, className: "text-blocked bg-blocked-dim border-blocked/40" },
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const { icon: Icon, className } = OUTCOMES[outcome];
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      <Icon size={13} aria-hidden="true" />
      {outcome}
    </span>
  );
}

export function TierBadge({ tier }: { tier?: string }) {
  return (
    <span className="mono inline-block min-w-[3.75rem] border border-line-strong px-1.5 py-0.5 text-center text-xs text-muted">
      {tier ?? "n/a"}
    </span>
  );
}

export function Address({ address, label }: { address: string; label?: string }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
      className="mono inline-flex items-center gap-1 text-sm hover:text-safe"
    >
      {label ?? short(address)}
      <ExternalLink size={12} className="text-muted" aria-hidden="true" />
      <span className="sr-only">(opens explorer)</span>
    </a>
  );
}

const STYLES = {
  primary: "bg-safe text-bg border-safe hover:brightness-110",
  danger: "bg-blocked text-bg border-blocked hover:brightness-110",
  outline: "bg-transparent text-ink border-line-strong hover:bg-raised",
  dangerOutline: "bg-transparent text-blocked border-blocked/60 hover:bg-blocked-dim",
};

export function Button({
  variant = "outline",
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof STYLES; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 border px-4 py-2 text-sm font-medium transition-[filter,background-color] active:brightness-90 disabled:cursor-not-allowed disabled:opacity-40 ${
        STYLES[variant]
      } ${props.className ?? ""}`}
    >
      {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-blocked">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      {error}
    </p>
  );
}

/** Wallet declines read better as what they are than as an error from deep in the adapter. */
export function humanError(err: unknown) {
  const text = describeError(err);
  if (/reject|declin|denied/i.test(text)) return "You declined this in your wallet.";
  if (/insufficient lamports|0x1\b|debit an account/i.test(text)) {
    return "This wallet does not have enough SOL or dUSDC for that.";
  }
  if (/AccountNotInitialized|could not find account|token account/i.test(text)) {
    return "The recipient has no dUSDC token account yet, so this cannot settle.";
  }
  return text;
}

const duration = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
};

/** Counts down to a unix time on the cluster's clock. */
export function Countdown({
  until,
  skew,
  done = "now",
}: {
  until: number;
  skew: number;
  done?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000 + skew);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [skew]);
  if (now === null) return <span className="mono">--:--:--</span>;
  return <span className="mono">{until > now ? duration(until - now) : done}</span>;
}

/** A confirmation for what cannot be taken back. Uses the native dialog, so focus is handled. */
export function Confirm({
  open,
  title,
  body,
  action,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  action: string;
  onConfirm(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto max-w-md border border-line-strong bg-raised p-6 text-ink"
    >
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-muted">{body}</div>
      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>
          {action}
        </Button>
      </div>
    </dialog>
  );
}
