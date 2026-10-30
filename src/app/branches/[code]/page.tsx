import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatMoney, openingHours, zoneLabel } from "@/components/format";
import { SearchForm } from "@/components/search-form";
import { Alert, Card, CardBody, CardHeader, CardTitle, Container, DescriptionList, PageHeader, PageSkeleton } from "@/components/ui";
import { zonedToday } from "@/components/zoned-time";
import { getBranchByCode, listBranches, listCategories } from "@/server/catalog";
import { readSearchForm } from "../../search/criteria";

export const metadata: Metadata = { title: "Branch" };

export default function BranchPage({ params }: PageProps<"/branches/[code]">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Branch params={params} />
    </Suspense>
  );
}

async function Branch({ params }: Pick<PageProps<"/branches/[code]">, "params">) {
  const { code } = await params;
  if (!/^[A-Za-z0-9-]{2,12}$/.test(code)) notFound();
  const branch = await getBranchByCode(code);
  if (!branch) notFound();
  const [branches, categories] = await Promise.all([listBranches(), listCategories()]);
  const values = readSearchForm({ pickup: branch.code }, branches);

  return (
    <Container className="py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href="/branches" className="hover:text-ink">
          ← All branches
        </Link>
      </nav>
      <PageHeader eyebrow={`${branch.city}, ${branch.emirate}`} title={branch.name} description={branch.address} />
      {!branch.isActive && (
        <Alert tone="warning" className="mb-6">
          This branch is not taking new rentals at the moment.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Branch details</CardTitle>
          </CardHeader>
          <CardBody>
            <DescriptionList
              items={[
                { label: "Opening hours", value: openingHours(branch.opensAtMinute, branch.closesAtMinute) },
                { label: "Time zone", value: `${branch.timeZone} (${zoneLabel(branch.timeZone)})` },
                { label: "Phone", value: branch.phone ? <a href={`tel:${branch.phone}`} className="text-brand-700">{branch.phone}</a> : "—" },
                { label: "VAT", value: `${branch.vatRateBp / 100}%` },
                { label: "One-way drop-off fee", value: branch.oneWayFeeFils > 0 ? formatMoney(branch.oneWayFeeFils) : "None" },
              ]}
            />
          </CardBody>
        </Card>
        {branch.isActive && (
          <Card>
            <CardHeader>
              <CardTitle>Find a car at {branch.name}</CardTitle>
            </CardHeader>
            <CardBody>
              <SearchForm branches={branches} categories={categories} values={values} minDate={zonedToday(branch.timeZone)} />
            </CardBody>
          </Card>
        )}
      </div>
    </Container>
  );
}
