import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { openingHours } from "@/components/format";
import { SearchForm } from "@/components/search-form";
import { Card, CardBody, Container, EmptyState, Skeleton } from "@/components/ui";
import { zonedToday } from "@/components/zoned-time";
import { listBranches, listCategories } from "@/server/catalog";
import { readSearchForm } from "./search/criteria";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 text-white">
        <div aria-hidden className="absolute -right-24 -top-24 size-96 rounded-full bg-white/5" />
        <div aria-hidden className="absolute -bottom-32 left-1/3 size-80 rounded-full bg-white/5" />
        <Container className="relative py-12 sm:py-16">
          <p className="text-sm font-medium text-brand-200">Dubai · Abu Dhabi · Sharjah</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
            Rent the right car in the UAE, in minutes.
          </h1>
          <p className="mt-3 max-w-xl text-brand-100">
            Live availability, clear prices in AED with VAT shown up front, and a pick-up voucher on your phone.
          </p>
          <Card className="mt-8 text-ink">
            <CardBody className="p-4 sm:p-6">
              <Suspense fallback={<Skeleton className="h-40" />}>
                <HomeSearch />
              </Suspense>
            </CardBody>
          </Card>
        </Container>
      </section>

      <Container className="py-12">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            { t: "Choose your dates", d: "Search by branch, dates and times. Only cars free for your whole trip are shown." },
            { t: "Add what you need", d: "Child seat, GPS, an extra driver or full insurance cover, priced before you pay." },
            { t: "Pick up with your voucher", d: "Show the QR code at the counter. Your deposit is held, never charged upfront." },
          ].map((s, i) => (
            <div key={s.t} className="flex gap-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800">
                {i + 1}
              </span>
              <div>
                <h2 className="font-semibold">{s.t}</h2>
                <p className="mt-1 text-sm text-muted">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>

      <Container className="pb-4">
        <h2 className="mb-4 text-xl font-bold tracking-tight">Our branches</h2>
        <Suspense fallback={<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>}>
          <BranchList />
        </Suspense>
      </Container>
    </>
  );
}

async function HomeSearch() {
  await connection();
  const [branches, categories] = await Promise.all([listBranches(), listCategories()]);
  if (branches.length === 0) {
    return <EmptyState title="No branches are open yet" description="Please check back soon." />;
  }
  const values = readSearchForm({}, branches);
  return (
    <SearchForm
      branches={branches}
      categories={categories}
      values={values}
      minDate={zonedToday(branches[0].timeZone)}
    />
  );
}

async function BranchList() {
  await connection();
  const branches = await listBranches();
  if (branches.length === 0) return <EmptyState title="No branches yet" />;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {branches.map((b) => (
        <li key={b.id}>
          <Link
            href={`/branches/${b.code}`}
            className="block rounded-2xl border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <p className="font-semibold">{b.name}</p>
            <p className="text-sm text-muted">
              {b.city}, {b.emirate}
            </p>
            <p className="mt-2 text-xs text-brand-700">{openingHours(b.opensAtMinute, b.closesAtMinute)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
