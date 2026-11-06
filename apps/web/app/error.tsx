"use client";

export default function ErrorPage({ reset }: { error: Error; reset(): void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="eyebrow">Something broke</p>
      <h1 className="mt-3 text-2xl font-semibold">This page hit an unexpected error.</h1>
      <p className="mt-2 text-sm text-muted">Your funds are onchain and were not affected.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 min-h-11 cursor-pointer border border-line-strong px-4 text-sm hover:bg-raised"
      >
        Try again
      </button>
    </div>
  );
}
