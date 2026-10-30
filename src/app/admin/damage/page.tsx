import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth-session";
import { listDamageReports } from "@/server/admin/operations";
import { DamageList } from "../_lib/damage";

export const metadata: Metadata = { title: "Admin · Damage reports" };

export default function DamagePage({ searchParams }: PageProps<"/admin/damage">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Damage searchParams={searchParams} />
    </Suspense>
  );
}

async function Damage({ searchParams }: Pick<PageProps<"/admin/damage">, "searchParams">) {
  const admin = await requireAdmin("/admin/damage");
  const sp = await searchParams;
  const status = sp.status === "RESOLVED" ? "RESOLVED" : sp.status === "ALL" ? undefined : "OPEN";
  const reports = await listDamageReports(admin.id, { status });
  const tabs = [
    { key: "OPEN", label: "Open" },
    { key: "RESOLVED", label: "Resolved" },
    { key: "ALL", label: "All" },
  ];
  const current = status ?? "ALL";
  return (
    <div className="space-y-6">
      <PageHeader title="Damage reports" description="Report new damage from a reservation or a vehicle page." />
      <nav aria-label="Filter" className="flex gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/admin/damage?status=${t.key}`}
            aria-current={current === t.key ? "page" : undefined}
            className="rounded-full border border-line px-3 py-1 text-sm aria-[current=page]:border-brand-600 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-800"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <DamageList reports={reports} timeZone="Asia/Dubai" showVehicle />
    </div>
  );
}
