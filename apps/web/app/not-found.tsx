import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-2xl font-semibold">There is nothing at this address.</h1>
      <Link href="/" className="mt-8 inline-block border border-line-strong px-4 py-2.5 text-sm">
        Back to the start
      </Link>
    </div>
  );
}
