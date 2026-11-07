"use client";

import { ArrowRight, CircleUser, FileCheck2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { addressUrl, PROGRAM, short } from "@/lib/chain";
import type { Outcome } from "@/lib/timeline";
import { OutcomeBadge, TierBadge } from "./ui";

const LAYERS = [
  {
    icon: FileCheck2,
    name: "Mandate",
    who: "Enforced by the program",
    text: "Caps, an allowlist and an expiry you signed. A small payment to a listed vendor passes here.",
    tier: "LOW",
    className: "text-safe",
  },
  {
    icon: ShieldCheck,
    name: "Guard co-sign",
    who: "A separate service and key",
    text: "It decodes the transaction, checks the rules, and asks an independent judge. No signature, no payment.",
    tier: "MEDIUM",
    className: "text-pending",
  },
  {
    icon: CircleUser,
    name: "Human or device",
    who: "You, or a hardware key",
    text: "Large or unlisted payments wait onchain and move nothing until you approve them.",
    tier: "HIGH",
    className: "text-blocked",
  },
];

// The scripted devnet run, as the console shows it. Order is the order the rows land.
const REPLAY: {
  tier: string;
  amount: number;
  to: string;
  outcome: Outcome;
  note?: string;
  attack?: boolean;
}[] = [
  { tier: "LOW", amount: 18, to: "Acme Design", outcome: "PAID", note: "agent alone" },
  { tier: "MEDIUM", amount: 120, to: "CloudHost Inc", outcome: "PAID", note: "guard co-signed" },
  { tier: "MEDIUM", amount: 45, to: "CloudHost Inc", outcome: "PAID", note: "guard co-signed" },
  {
    tier: "HIGH",
    amount: 150,
    to: "Unlisted address",
    outcome: "PENDING",
    note: "hidden line in an invoice",
    attack: true,
  },
  {
    tier: "DIRECT",
    amount: 150,
    to: "Unlisted address",
    outcome: "BLOCKED BY CHAIN",
    note: "NotAllowlisted",
    attack: true,
  },
  {
    tier: "MEDIUM",
    amount: 190,
    to: "CloudHost Inc",
    outcome: "BLOCKED BY GUARD",
    note: "task approved 60",
    attack: true,
  },
];

/** The hero's proof: the attack run, replayed row by row in the console's own components. */
export function AttackReplay() {
  return (
    <figure className="border border-line-strong bg-surface shadow-2xl shadow-black/40">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="eyebrow">Agent pays 4 invoices, 2 are poisoned</span>
        <span className="mono flex items-center gap-2 text-xs text-muted">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-safe" aria-hidden="true" />
          devnet
        </span>
      </figcaption>
      <ol className="divide-y divide-line">
        {REPLAY.map((r, i) => (
          <li
            key={i}
            className={`replay-row grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 sm:grid-cols-[4.25rem_3rem_minmax(0,1fr)_auto] ${
              r.attack ? "bg-blocked-dim/60" : ""
            }`}
            style={{ animationDelay: `${300 + i * 450}ms` }}
          >
            <span className="hidden sm:block">
              <TierBadge tier={r.tier} />
            </span>
            <span className="mono text-sm font-medium">{r.amount}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{r.to}</span>
              <span
                className={`mono block truncate text-[11px] ${
                  r.attack ? "text-blocked" : "text-muted"
                }`}
              >
                {r.note}
              </span>
            </span>
            <OutcomeBadge outcome={r.outcome} />
          </li>
        ))}
      </ol>
      <p
        className="replay-row flex items-baseline justify-between gap-3 border-t border-line-strong px-4 py-3"
        style={{ animationDelay: `${300 + REPLAY.length * 450}ms` }}
      >
        <span className="eyebrow">Attacker received</span>
        <span className="mono text-2xl font-medium text-safe">
          0 <span className="text-sm text-muted">dUSDC</span>
        </span>
      </p>
    </figure>
  );
}

export function LayerDiagram() {
  return (
    <div>
      <div className="relative hidden h-5 overflow-hidden md:block" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
        <div className="token-track absolute inset-0">
          <span className="absolute top-1/2 -mt-1 h-2 w-2 rounded-full bg-safe" />
        </div>
      </div>
      <ol className="grid gap-px bg-line md:grid-cols-3">
        {LAYERS.map((layer, i) => (
          <li
            key={layer.name}
            className="layer-card bg-surface p-5"
            style={{ animationDelay: `${i * 1.66}s` }}
          >
            <div className="flex items-center justify-between">
              <span className="eyebrow">Layer {i + 1}</span>
              <span className={`mono text-xs font-medium ${layer.className}`}>{layer.tier}</span>
            </div>
            <layer.icon size={24} className="mt-4" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-semibold">{layer.name}</h3>
            <p className="mono mt-1 text-xs text-muted">{layer.who}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted">{layer.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LiveStats() {
  const [stats, setStats] = useState<{
    vaults?: number;
    blocked?: number;
    sampled?: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats"))))
      .then(setStats, () => setFailed(true));
  }, []);

  const value = (n?: number) =>
    n !== undefined ? (
      <span>{n.toLocaleString("en-US")}</span>
    ) : failed || stats ? (
      <span className="text-muted">n/a</span>
    ) : (
      <span className="skeleton inline-block h-7 w-16 align-middle" aria-label="Loading" />
    );

  return (
    <dl className="grid gap-px bg-line sm:grid-cols-3">
      <div className="bg-surface p-5">
        <dt className="eyebrow">Program, devnet</dt>
        <dd className="mt-2">
          <a
            href={addressUrl(PROGRAM)}
            target="_blank"
            rel="noreferrer"
            className="mono inline-flex items-center gap-2 text-2xl font-medium hover:text-safe"
          >
            {short(PROGRAM)}
            <ArrowRight size={16} className="text-muted" aria-hidden="true" />
            <span className="sr-only">(opens explorer)</span>
          </a>
        </dd>
      </div>
      <div className="bg-surface p-5">
        <dt className="eyebrow">Vaults onchain</dt>
        <dd className="mono mt-2 text-2xl font-medium">{value(stats?.vaults)}</dd>
      </div>
      <div className="bg-surface p-5">
        <dt className="eyebrow">Blocked attempts</dt>
        <dd className="mono mt-2 text-2xl font-medium text-blocked">{value(stats?.blocked)}</dd>
        <dd className="mt-1 text-xs text-muted">
          Refused by the program, in its last {stats?.sampled?.toLocaleString("en-US") ?? "1,000"}{" "}
          transactions
        </dd>
      </div>
    </dl>
  );
}
