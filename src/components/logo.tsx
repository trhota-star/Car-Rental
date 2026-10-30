export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M5 16h14l-1.5-5.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5L5 16Z" strokeLinejoin="round" />
          <path d="M3 16h18v2a1 1 0 0 1-1 1h-1M3 16v2a1 1 0 0 0 1 1h1" strokeLinejoin="round" />
          <circle cx="7.5" cy="19" r="1.5" />
          <circle cx="16.5" cy="19" r="1.5" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight text-ink">
        Drive<span className="text-brand-600">Easy</span>
      </span>
    </span>
  );
}
