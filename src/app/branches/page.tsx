import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatMoney, openingHours } from "@/components/format";
import { Badge, Container, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { listBranches } from "@/server/catalog";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <Container className="py-8">
      <PageHeader title="Branches" description="Pick up and return at any DriveEasy branch across the UAE." />
      <Suspense fallback={<div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>}>
        <Branches />
      </Suspense>
    </Container>
  );
}

async function Branches() {
  await connection();
  const branches = await listBranches();
  if (branches.length === 0) return <EmptyState title="No branches are open yet" description="Please check back soon." />;
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {branches.map((b) => (
        <li key={b.id}>
          <Link
            href={`/branches/${b.code}`}
            className="flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{b.name}</h2>
                <p className="text-sm text-muted">
                  {b.city}, {b.emirate}
                </p>
              </div>
              <Badge tone="brand">{openingHours(b.opensAtMinute, b.closesAtMinute)}</Badge>
            </div>
            <p className="text-sm text-slate-700">{b.address}</p>
            {b.oneWayFeeFils > 0 && (
              <p className="text-xs text-muted">One-way drop-off fee here: {formatMoney(b.oneWayFeeFils)}</p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
