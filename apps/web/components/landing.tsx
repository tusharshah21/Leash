"use client";

import { ArrowRight, CircleUser, FileCheck2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { addressUrl, PROGRAM, short } from "@/lib/chain";

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

export function LayerDiagram() {
  return (
    <div>
      <div className="relative hidden h-5 md:block" aria-hidden="true">
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
  const [stats, setStats] = useState<{ vaults: number; blocked: number; sampled: number } | null>(
    null
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats"))))
      .then(setStats, () => setFailed(true));
  }, []);

  const value = (n?: number) =>
    n !== undefined ? (
      <span>{n.toLocaleString("en-US")}</span>
    ) : failed ? (
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
          Refused by the program, in its last {stats?.sampled.toLocaleString("en-US") ?? "1,000"}{" "}
          transactions
        </dd>
      </div>
    </dl>
  );
}
