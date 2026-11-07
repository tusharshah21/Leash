"use client";

// A minimal Blink client for our own Actions: GET what to show, POST for a transaction, sign it with
// the connected wallet. Inside Phantom's in-app browser this is the one-tap path from a phone.
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { useCallback, useEffect, useState } from "react";
import { txUrl } from "@/lib/chain";
import { Button, Card, ErrorText, humanError, Skeleton } from "./ui";

interface Action {
  icon: string;
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  links?: { actions: { label: string; href: string }[] };
}

export function BlinkView({ path }: { path: string }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; signature: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(path);
    const body = await res.json();
    if (!res.ok) throw new Error(body.message);
    setAction(body);
  }, [path]);

  useEffect(() => {
    load().catch((err) => setError(humanError(err)));
  }, [load]);

  const run = async (label: string, href: string) => {
    if (!wallet) return;
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: wallet.publicKey.toBase58() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      const signed = await wallet.signTransaction(
        Transaction.from(Buffer.from(body.transaction, "base64"))
      );
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(signature, "confirmed");
      setDone({ message: body.message, signature });
      await load();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(null);
    }
  };

  const buttons = action?.links?.actions ?? (action ? [{ label: action.label, href: path }] : []);
  const unlisted = !!action?.title.startsWith("NOT ON ALLOWLIST");

  return (
    <div className="mx-auto max-w-md px-4 py-6 md:py-10">
      <Card>
        {action ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={action.icon} alt="" width={800} height={800} className="h-auto w-full" />
            <div className="space-y-3 p-4">
              <h1 className="text-lg font-semibold">{action.title}</h1>
              <p className="text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line text-muted">
                {action.description}
              </p>
              {!action.disabled && !done && (
                <div className="flex flex-col gap-3 pt-1">
                  {buttons.map(({ label, href }) => (
                    <Button
                      key={label}
                      variant={label === "Approve" ? (unlisted ? "outline" : "primary") : "danger"}
                      busy={busy === label}
                      disabled={!wallet || !!busy}
                      onClick={() => void run(label, href)}
                      className="w-full"
                    >
                      {label}
                    </Button>
                  ))}
                  {!wallet && (
                    <p className="text-xs text-muted">
                      Connect the owner&apos;s wallet at the top of this page, on devnet.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          !error && <Skeleton className="h-96 w-full" />
        )}
        <div className="space-y-2 px-4 pb-4 empty:hidden">
          <ErrorText error={error} />
          {done && (
            <p role="status" className="text-sm text-safe">
              {done.message}{" "}
              <a
                href={txUrl(done.signature)}
                target="_blank"
                rel="noreferrer"
                className="mono text-xs underline"
              >
                View transaction
              </a>
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
