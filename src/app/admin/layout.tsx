import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth-session";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/reservations", label: "Reservations" },
  { href: "/admin/fleet", label: "Fleet" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/pricing", label: "Pricing & extras" },
  { href: "/admin/damage", label: "Damage reports" },
];

// Non-admins get a real 404 from src/proxy.ts; every page and action checks again.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      <aside className="lg:w-52 lg:shrink-0">
        <Suspense fallback={<Skeleton className="h-48" />}>
          <AdminNav />
        </Suspense>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

async function AdminNav() {
  // Every admin page also checks the role itself; this keeps the nav hidden from others.
  const admin = await requireAdmin();
  return (
    <nav aria-label="Admin" className="rounded-2xl border border-line bg-surface p-2 shadow-sm">
      <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Admin · {admin.name}</p>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
