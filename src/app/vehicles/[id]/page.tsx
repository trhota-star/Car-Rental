import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { formatDateTime, formatMoney, openingHours } from "@/components/format";
import { PriceBreakdown } from "@/components/price-breakdown";
import { RentalWindowForm } from "@/components/rental-window-form";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, CardTitle, Container, PageSkeleton } from "@/components/ui";
import { VehicleImage } from "@/components/vehicle-image";
import { VehicleSpecs } from "@/components/vehicle-card";
import { utcToZoned, zonedToday } from "@/components/zoned-time";
import { getVehicle, getVehicleCalendar, isVehicleAvailable } from "@/server/availability";
import { listBranches } from "@/server/catalog";
import { quoteRental, type Quote } from "@/server/pricing";
import { toActionError } from "../../_lib/service-errors";
import { readSearchForm, resolveSearch, windowQuery } from "../../search/criteria";

export const metadata: Metadata = { title: "Vehicle details" };

export default function VehiclePage({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <VehicleDetails params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function VehicleDetails({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await getVehicle(id);
  if (!data || data.vehicle.status === "RETIRED") notFound();
  const { vehicle, category, branch, features } = data;

  const active = await listBranches();
  const branches = active.some((b) => b.id === branch.id) ? active : [branch, ...active];
  // The car is collected from its own branch, whatever the URL says.
  const form = readSearchForm({ ...sp, pickup: branch.code }, branches);
  const resolved = resolveSearch(form, branches, []);

  let quote: Quote | null = null;
  let available = false;
  let problem: string | undefined;
  if (resolved.ok) {
    try {
      available = await isVehicleAvailable(vehicle.id, resolved.pickupAt, resolved.returnAt);
      if (available) {
        quote = await quoteRental({
          vehicleId: vehicle.id,
          pickupBranchId: resolved.pickupBranch.id,
          returnBranchId: resolved.returnBranch.id,
          pickupAt: resolved.pickupAt,
          returnAt: resolved.returnAt,
          extras: [],
        });
      }
    } catch (err) {
      problem = toActionError(err, "vehicle.quote", { vehicleId: vehicle.id }).message;
      available = false;
    }
  }

  const calendarFrom = zonedToday(branch.timeZone);
  const calendar = await getVehicleCalendar(vehicle.id, { from: calendarFrom });
  const selected =
    resolved.ok && available
      ? {
          from: utcToZoned(resolved.pickupAt, branch.timeZone).date,
          to: utcToZoned(new Date(resolved.returnAt.getTime() - 1), branch.timeZone).date,
        }
      : undefined;
  const query = windowQuery(form);

  return (
    <Container className="py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href={`/search?${query}`} className="hover:text-ink">
          ← Back to results
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <VehicleImage vehicle={vehicle} className="aspect-[16/8]" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">
                    {vehicle.make} {vehicle.model}
                  </h1>
                  <p className="text-sm text-muted">
                    {vehicle.year}
                    {vehicle.color ? ` · ${vehicle.color}` : ""} · based at{" "}
                    <Link href={`/branches/${branch.code}`} className="text-brand-700 hover:underline">
                      {branch.name}
                    </Link>
                  </p>
                </div>
                <Badge tone="brand">{category.name}</Badge>
              </div>
              <VehicleSpecs vehicle={vehicle} />
              {vehicle.description && <p className="text-sm text-slate-700">{vehicle.description}</p>}
              {features.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Features">
                  {features.map((f) => (
                    <li key={f.id}>
                      <Badge>{f.name}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-muted">
                Security deposit for {category.name}: <span className="font-medium text-ink">{formatMoney(category.securityDepositFils)}</span>{" "}
                (held on your card, not charged).
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
            </CardHeader>
            <CardBody>
              <AvailabilityCalendar days={calendar.days} selected={selected} timeZone={calendar.timeZone} />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Your dates</CardTitle>
              <p className="mt-1 text-xs text-muted">
                Pick-up at {branch.name} ({openingHours(branch.opensAtMinute, branch.closesAtMinute)}). Times are local
                to each branch.
              </p>
            </CardHeader>
            <CardBody className="space-y-4">
              <RentalWindowForm
                action={`/vehicles/${vehicle.id}`}
                pickupBranch={branch}
                branches={branches}
                values={form}
                errors={resolved.ok ? {} : resolved.errors}
                minDate={calendarFrom}
              />
              {problem && <Alert tone="error">{problem}</Alert>}
              {resolved.ok && !problem && !available && (
                <Alert tone="warning" title="Not available for these dates">
                  This car is booked between {formatDateTime(resolved.pickupAt, branch.timeZone)} and{" "}
                  {formatDateTime(resolved.returnAt, resolved.returnBranch.timeZone)}. Check the calendar for free days.
                </Alert>
              )}
              {resolved.ok && available && quote && (
                <>
                  <Alert tone="success">Available for your dates.</Alert>
                  <PriceBreakdown quote={quote} title="Price without extras" />
                  <ButtonLink href={`/book/${vehicle.id}?${query}`} size="lg" className="w-full">
                    Continue to extras
                  </ButtonLink>
                </>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
