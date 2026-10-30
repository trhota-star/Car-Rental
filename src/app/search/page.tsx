import type { Metadata } from "next";
import { Suspense } from "react";
import { formatDateTime } from "@/components/format";
import { SearchForm } from "@/components/search-form";
import { Alert, ButtonLink, Card, CardBody, Container, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { VehicleCard } from "@/components/vehicle-card";
import { zonedToday } from "@/components/zoned-time";
import { searchVehicles, type SearchResult } from "@/server/availability";
import { listBranches, listCategories } from "@/server/catalog";
import { toActionError } from "../_lib/service-errors";
import { readSearchForm, resolveSearch, windowQuery } from "./criteria";

export const metadata: Metadata = { title: "Find a car" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Container className="py-8">
      <PageHeader title="Find a car" description="Only cars free for your whole rental period are shown." />
      <Suspense fallback={<SearchSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function SearchResults({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const sp = await searchParams;
  const [branches, categories] = await Promise.all([listBranches(), listCategories()]);
  if (branches.length === 0) {
    return <EmptyState title="No branches are open yet" description="Please check back soon." />;
  }
  const form = readSearchForm(sp, branches);
  const resolved = resolveSearch(form, branches, categories);

  let results: SearchResult[] = [];
  let error: string | undefined;
  if (resolved.ok) {
    try {
      results = await searchVehicles({
        pickupBranchId: resolved.pickupBranch.id,
        returnBranchId: resolved.returnBranch.id,
        pickupAt: resolved.pickupAt,
        returnAt: resolved.returnAt,
        categoryId: resolved.category?.id,
        transmission: form.transmission,
        fuelType: form.fuel,
        minSeats: form.seats,
        maxDailyRateFils: form.maxPrice ? form.maxPrice * 100 : undefined,
        sort: form.sort,
      });
    } catch (err) {
      error = toActionError(err, "search", { pickup: form.pickup }).message;
    }
  }

  const query = windowQuery(form);
  const minDate = zonedToday(branches.find((b) => b.code === form.pickup)?.timeZone ?? "Asia/Dubai");

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <SearchForm
            branches={branches}
            categories={categories}
            values={form}
            errors={resolved.ok ? {} : resolved.errors}
            showFilters
            minDate={minDate}
          />
        </CardBody>
      </Card>

      {error && <Alert tone="error" title="We couldn't search with those details">{error}</Alert>}

      {resolved.ok && !error && (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            <span className="font-semibold text-ink" data-testid="result-count">
              {results.length} {results.length === 1 ? "car" : "cars"} available
            </span>{" "}
            at {resolved.pickupBranch.name} from {formatDateTime(resolved.pickupAt, resolved.pickupBranch.timeZone)} to{" "}
            {formatDateTime(resolved.returnAt, resolved.returnBranch.timeZone)}
            {resolved.returnBranch.id !== resolved.pickupBranch.id && <> (return to {resolved.returnBranch.name})</>}.
          </p>
          {results.length === 0 ? (
            <EmptyState
              title="No cars match your search"
              description="Try different dates, another branch, or remove some filters."
              action={
                <ButtonLink href={`/search?${query}`} variant="outline">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((r) => (
                <li key={r.vehicle.id}>
                  <VehicleCard
                    vehicle={r.vehicle}
                    category={r.category}
                    dailyRateFils={r.dailyRateFils}
                    estimatedTotalFils={r.estimatedTotalFils}
                    rentalDays={r.rentalDays}
                    href={`/vehicles/${r.vehicle.id}?${query}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div role="status" className="space-y-6">
      <Skeleton className="h-56" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-80" />
        ))}
      </div>
      <span className="sr-only">Loading cars…</span>
    </div>
  );
}
