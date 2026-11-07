"use client";

import type { ActivityEntry } from "@leash/sdk";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { pendingPath } from "@/lib/actions";
import { dusdc, short, txUrl } from "@/lib/chain";
import { proposalContext } from "@/lib/timeline";
import type { useSigner, VaultData } from "@/lib/use-vault";
import { PhoneLink } from "./phone-link";
import { Address, Button, Card, Confirm, Countdown, ErrorText, humanError } from "./ui";

interface Props {
  pending: VaultData["pending"];
  activity: ActivityEntry[];
  address: string;
  labels: Map<string, string>;
  listed: Set<string>;
  ttl: number;
  skew: number;
  isOwner: boolean;
  device?: string;
  signer: ReturnType<typeof useSigner>;
  refresh(): Promise<void>;
}

export function PendingQueue(props: Props) {
  const { pending } = props;
  return (
    <Card
      title="Pending queue"
      aside={<span className="mono text-xs text-muted">{pending.length} waiting</span>}
    >
      {pending.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          Nothing is waiting for a human. High-risk payments appear here until you decide them.
        </p>
      ) : (
        <div className="space-y-3 p-3">
          {[...pending]
            .sort((a, b) => Number(b.nonce - a.nonce))
            .map((p) => (
              <PendingCard key={p.nonce.toString()} item={p} {...props} />
            ))}
        </div>
      )}
    </Card>
  );
}

function PendingCard({
  item,
  activity,
  address,
  labels,
  listed,
  ttl,
  skew,
  isOwner,
  device,
  signer,
  refresh,
}: Props & { item: VaultData["pending"][number] }) {
  const recipient = item.recipient.toBase58();
  const onList = listed.has(recipient);
  const nonce = item.nonce.toString();
  const { memo, reasoning, review } = proposalContext(activity, nonce);
  const expiresAt = item.createdAt.toNumber() + ttl;

  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const decide = async (action: "approve" | "reject") => {
    if (!signer) return;
    setConfirming(false);
    setBusy(action);
    setError(null);
    try {
      const signature =
        action === "approve" ? await signer.approve(item.nonce) : await signer.reject(item.nonce);
      setDone(signature);
      await refresh();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      aria-label={`Pending payment of ${dusdc(item.amount.toString())} dUSDC`}
      className={`row-new border p-4 ${
        onList ? "border-pending/50" : "border-blocked bg-blocked-dim"
      }`}
    >
      {!onList && (
        <p className="mono mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-blocked">
          <ShieldAlert size={18} aria-hidden="true" />
          NOT ON ALLOWLIST
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mono text-3xl font-medium tracking-tight">
            {dusdc(item.amount.toString())}
            <span className="ml-2 text-sm text-muted">dUSDC</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">to</span>
            <span className="font-medium">{labels.get(recipient) ?? "Unknown recipient"}</span>
            <Address address={recipient} />
          </p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="eyebrow">Expires in</p>
          <p className="mt-1">
            <Countdown until={expiresAt} skew={skew} done="expired" />
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        <div className="border border-line bg-bg/60 p-3">
          <p className="eyebrow">Agent&apos;s reasoning</p>
          {reasoning ? (
            <p className="mt-2 text-sm leading-relaxed">{reasoning}</p>
          ) : (
            <p className="mt-2 text-sm text-muted">No offchain record for this proposal.</p>
          )}
          {memo && <p className="mono mt-2 text-xs text-muted">Memo: {memo}</p>}
        </div>
        <div className="border border-line bg-bg/60 p-3">
          <p className="eyebrow">Guard review, advisory</p>
          {review ? (
            <>
              <p
                className={`mono mt-2 text-sm font-medium ${
                  (review.risk ?? 0) >= 50 ? "text-blocked" : "text-safe"
                }`}
              >
                Risk {review.risk ?? "n/a"} / 100
              </p>
              <p className="mt-1 text-sm leading-relaxed">{review.rationale}</p>
              {review.findings?.map((f) => (
                <p key={f} className="mt-1 text-xs text-muted">
                  Rule: {f}
                </p>
              ))}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">The guard has not reviewed this proposal.</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant={onList ? "primary" : "outline"}
          busy={busy === "approve"}
          disabled={!isOwner || !!busy}
          onClick={() => (onList ? void decide("approve") : setConfirming(true))}
        >
          Approve
        </Button>
        <Button
          variant={onList ? "outline" : "danger"}
          busy={busy === "reject"}
          disabled={!isOwner || !!busy}
          onClick={() => void decide("reject")}
        >
          Reject
        </Button>
        <PhoneLink
          path={pendingPath(address, nonce)}
          label="Approve from phone"
          title="Decide this from your phone"
        />
        {!isOwner && (
          <p className="text-xs text-muted">
            Connect the owner wallet to decide this.
            {device ? ` The device key ${short(device)} can also approve or reject.` : ""}
          </p>
        )}
        {isOwner && device && (
          <p className="text-xs text-muted">The device key {short(device)} can also decide this.</p>
        )}
      </div>
      <div className="mt-3 empty:hidden">
        <ErrorText error={error} />
        {done && (
          <a href={txUrl(done)} target="_blank" rel="noreferrer" className="mono text-xs underline">
            View transaction
          </a>
        )}
      </div>
      <Confirm
        open={confirming}
        title="Approve a recipient you have not allowlisted?"
        body={
          <>
            This sends <span className="mono">{dusdc(item.amount.toString())} dUSDC</span> to{" "}
            <span className="mono break-all">{recipient}</span>, which is not on your allowlist. It
            cannot be undone.
          </>
        }
        action="Approve anyway"
        onConfirm={() => void decide("approve")}
        onClose={() => setConfirming(false)}
      />
    </article>
  );
}
