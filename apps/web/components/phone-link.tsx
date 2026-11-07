"use client";

import { Check, Copy, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { blinkPage, dialUrl, phantomUrl } from "@/lib/actions";
import { Button } from "./ui";

/** A button that opens a QR code of this action's Blink, with a link to copy. */
export function PhoneLink({ path, label, title }: { path: string; label: string; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [site, setSite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (site) ref.current?.showModal();
  }, [site]);

  const link = site && phantomUrl(site, path);
  const local = !!site && /\/\/(localhost|127\.|\[::1\])/.test(site);

  return (
    <>
      <Button
        onClick={() =>
          setSite((process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, ""))
        }
      >
        <Smartphone size={15} aria-hidden="true" /> {label}
      </Button>
      <dialog
        ref={ref}
        onClose={() => {
          setSite(null);
          setCopied(false);
        }}
        className="m-auto w-full max-w-sm border border-line-strong bg-raised p-6 text-ink"
      >
        <h3 className="text-lg font-semibold">{title}</h3>
        {link && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Scan with your phone&apos;s camera. It opens in Phantom, where you connect the
              owner&apos;s wallet on devnet and tap once.
            </p>
            {local && (
              <p role="status" className="mt-3 border border-pending/40 p-2 text-xs text-pending">
                A phone cannot reach this machine. Set NEXT_PUBLIC_SITE_URL to the deployed site for
                a code that works.
              </p>
            )}
            <div className="mt-4 flex justify-center bg-white p-4">
              <QRCodeSVG value={link} size={240} title="QR code of the Blink link" />
            </div>
            <p className="mono mt-3 flex justify-center gap-4 text-xs text-muted">
              <a
                href={blinkPage(site, path)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open here
              </a>
              <a
                href={dialUrl(`${site}${path}`)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Try dial.to
              </a>
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <Button
                onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
              >
                {copied ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <Copy size={15} aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button onClick={() => ref.current?.close()}>Close</Button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
