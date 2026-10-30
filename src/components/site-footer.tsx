import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-line bg-white">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-6">
        <div className="space-y-2">
          <Logo />
          <p className="text-muted">Car rental across the UAE. Prices in AED, VAT included at checkout.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-2">
          <Link href="/search" className="text-slate-600 hover:text-ink">
            Find a car
          </Link>
          <Link href="/branches" className="text-slate-600 hover:text-ink">
            Branches
          </Link>
          <Link href="/reservations" className="text-slate-600 hover:text-ink">
            My rentals
          </Link>
        </nav>
        <div className="space-y-1 text-muted">
          <p>Cancellation terms are shown before you pay.</p>
          <p>Security deposit is held on your card, not charged.</p>
        </div>
      </div>
    </footer>
  );
}
