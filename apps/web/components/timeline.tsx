"use client";

import {
  BadgeCheck,
  ChevronRight,
  ExternalLink,
  ShieldQuestion,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { dusdc, short, txUrl } from "@/lib/chain";
import type { Row } from "@/lib/timeline";
import { Card, OutcomeBadge, Skeleton, TierBadge } from "./ui";

export function Timeline({
  rows,
  labels,
  address,
  offline,
  loading,
}: {
  rows: Row[];
  labels: Map<string, string>;
  address: string;
  offline: boolean;
  loading: boolean;
}) {
  // Only rows that arrive after the first paint get the entrance animation.
  const seen = useRef<Set<string> | null>(null);
  const known = seen.current;
  useEffect(() => {
    seen.current = new Set(rows.map((r) => r.id));
  }, [rows]);

  return (
    <Card
      title="Timeline"
      aside={
        <span className="mono flex items-center gap-2 text-xs text-muted">
          <span
            className={`live-dot h-1.5 w-1.5 rounded-full ${offline ? "bg-pending" : "bg-safe"}`}
            aria-hidden="true"
          />
          {offline ? "Reconnecting" : "Live"}
        </span>
      }
    >
      {loading ? (
        // Offchain rows alone would misrepresent the vault, so nothing shows until the chain has.
        <div className="space-y-px" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
          <span className="sr-only">Loading the vault&apos;s history</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm">No agent activity on this vault yet.</p>
          <p className="mono mt-3 text-xs break-all text-muted">pnpm demo:run --vault {address}</p>
        </div>
      ) : (
        <ol aria-live="polite" className="divide-y divide-line">
          {rows.map((row) => (
            <TimelineRow
              key={row.id}
              row={row}
              labels={labels}
              isNew={known !== null && !known.has(row.id)}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}

const time = (ts: number) =>
  ts
    ? new Date(ts * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

function recipientName(row: Row, labels: Map<string, string>) {
  if (row.recipient) return labels.get(row.recipient) ?? `Unlisted ${short(row.recipient)}`;
  return row.recipientTokenAccount ? `token ${short(row.recipientTokenAccount)}` : "unknown";
}

function TimelineRow({
  row,
  labels,
  isNew,
}: {
  row: Row;
  labels: Map<string, string>;
  isNew: boolean;
}) {
  return (
    <li className={isNew ? "row-new" : ""}>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-raised md:grid-cols-[2.75rem_4.25rem_3.5rem_minmax(0,1fr)_auto_1rem] [&::-webkit-details-marker]:hidden">
          <span className="mono hidden text-xs text-muted md:block">{time(row.ts)}</span>
          <TierBadge
            tier={row.tier ?? (row.outcome === "BLOCKED BY CHAIN" ? "DIRECT" : undefined)}
          />
          <span className="mono text-sm font-medium">{dusdc(row.amount)}</span>
          <span className="col-span-2 truncate text-sm md:col-span-1" title={row.recipient}>
            {recipientName(row, labels)}
          </span>
          <span className="justify-self-end md:justify-self-start">
            <OutcomeBadge outcome={row.outcome} />
          </span>
          <ChevronRight
            size={15}
            className="hidden text-muted transition-transform duration-150 group-open:rotate-90 md:block"
            aria-hidden="true"
          />
        </summary>
        <Why row={row} />
      </details>
    </li>
  );
}

function Why({ row }: { row: Row }) {
  return (
    <div className="space-y-3 border-t border-line bg-bg/60 px-4 py-4 text-sm">
      {row.offchain && (
        <p className="mono text-xs font-medium text-pending">
          Offchain {row.outcome === "BLOCKED BY GUARD" ? "guard decision" : "record"}. This never
          reached the chain, so its only source is the local log.
        </p>
      )}

      <Field label="Agent's reasoning">
        {row.reasoning ? (
          <p className="leading-relaxed">{row.reasoning}</p>
        ) : (
          <p className="text-muted">No offchain record for this transaction.</p>
        )}
        {row.memo && <p className="mono mt-1 text-xs text-muted">Memo: {row.memo}</p>}
        <VerifiedBadge row={row} />
      </Field>

      {row.guard && (
        <Field label="Guard">
          <p className="mono text-xs">
            <span className={row.guard.verdict === "deny" ? "text-blocked" : "text-safe"}>
              {row.guard.verdict?.toUpperCase() ?? "NO VERDICT"}
            </span>
            {row.guard.risk !== undefined && (
              <span className="text-muted"> / risk {row.guard.risk}</span>
            )}
          </p>
          {row.guard.rationale && <p className="mt-1 leading-relaxed">{row.guard.rationale}</p>}
        </Field>
      )}

      {row.review && (
        <Field label="Guard review, advisory">
          <p className="mono text-xs text-muted">Risk {row.review.risk ?? "n/a"} / 100</p>
          {row.review.rationale && <p className="mt-1 leading-relaxed">{row.review.rationale}</p>}
        </Field>
      )}

      {row.outcome === "BLOCKED BY CHAIN" && row.error && (
        <Field label="Program error">
          <p className="mono text-blocked">{row.error}</p>
        </Field>
      )}
      {row.outcome === "FAILED" && row.error && (
        <Field label="Error">
          <p className="text-blocked">{row.error}</p>
        </Field>
      )}

      <div className="flex flex-wrap gap-4">
        {row.signature && <TxLink signature={row.signature} label="Transaction" />}
        {row.settledBy && <TxLink signature={row.settledBy} label="Decision" />}
      </div>
    </div>
  );
}

function VerifiedBadge({ row }: { row: Row }) {
  if (row.verification === "verified") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 border border-safe/40 bg-safe-dim px-2 py-0.5 text-xs font-medium text-safe">
        <BadgeCheck size={13} aria-hidden="true" /> Reasoning verified onchain
      </p>
    );
  }
  if (row.verification === "mismatch") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 border border-blocked/40 bg-blocked-dim px-2 py-0.5 text-xs font-medium text-blocked">
        <TriangleAlert size={13} aria-hidden="true" /> Unverified: does not match the onchain hash
      </p>
    );
  }
  if (row.reasoning) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted">
        <ShieldQuestion size={13} aria-hidden="true" /> No onchain hash to check this against
      </p>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1">{label}</p>
      {children}
    </div>
  );
}

function TxLink({ signature, label }: { signature: string; label: string }) {
  return (
    <a
      href={txUrl(signature)}
      target="_blank"
      rel="noreferrer"
      className="mono inline-flex items-center gap-1 text-xs hover:text-safe"
    >
      {label} {short(signature)}
      <ExternalLink size={12} className="text-muted" aria-hidden="true" />
      <span className="sr-only">(opens explorer)</span>
    </a>
  );
}
