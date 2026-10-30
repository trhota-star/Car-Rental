"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/button";

/** Shared body for error.tsx boundaries. */
export function ErrorView({ error, retry, title = "Something went wrong" }: { error: unknown; retry: () => void; title?: string }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">
        We couldn&apos;t load this page. Please try again. If the problem continues, contact support
        {digest ? (
          <>
            {" "}
            and quote reference <code className="font-mono">{digest}</code>
          </>
        ) : null}
        .
      </p>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("outline")}>
          Go home
        </Link>
      </div>
    </div>
  );
}
