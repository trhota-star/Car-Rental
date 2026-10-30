import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth-session";
import { signOutAction } from "@/app/(auth)/actions";
import { ButtonLink, Skeleton } from "@/components/ui";
import { Logo } from "./logo";

const navLinks = [
  { href: "/search", label: "Find a car" },
  { href: "/branches", label: "Branches" },
  { href: "/reservations", label: "My rentals" },
];

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="DriveEasy home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Suspense fallback={<Skeleton className="h-9 w-40" />}>
            <UserNav />
          </Suspense>
        </div>

        {/* Mobile menu: native <details>, works without JavaScript. */}
        <details className="group relative md:hidden">
          <summary
            className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-white p-2 shadow-lg">
            <nav aria-label="Mobile" className="flex flex-col">
              {navLinks.map((l) => (
                <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 border-t border-line pt-2">
              <Suspense fallback={<Skeleton className="h-9 w-full" />}>
                <UserNav mobile />
              </Suspense>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}

async function UserNav({ mobile = false }: { mobile?: boolean }) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className={mobile ? "flex flex-col gap-2" : "flex items-center gap-2"}>
        <ButtonLink href="/login" variant="ghost" size="sm">
          Sign in
        </ButtonLink>
        <ButtonLink href="/register" size="sm">
          Create account
        </ButtonLink>
      </div>
    );
  }

  const linkClass = mobile
    ? "rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100"
    : "rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-ink";

  return (
    <div className={mobile ? "flex flex-col" : "flex items-center gap-1"}>
      {user.role === "ADMIN" && (
        <Link href="/admin" className={linkClass}>
          Admin
        </Link>
      )}
      <Link href="/profile" className={linkClass} title={user.email}>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
          >
            {initials(user.name)}
          </span>
          <span className="max-w-32 truncate">{user.name}</span>
        </span>
      </Link>
      <form action={signOutAction}>
        <button type="submit" className={`${linkClass} w-full text-left`}>
          Sign out
        </button>
      </form>
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}
