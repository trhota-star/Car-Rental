import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-slate-200/70", className)} />;
}

/** Generic page placeholder used by loading.tsx files and Suspense fallbacks. */
export function PageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div role="status" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
