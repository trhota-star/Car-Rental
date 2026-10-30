import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { formatDateTime } from "@/components/format";
import { PriceBreakdown } from "@/components/price-breakdown";
import { Alert, Card, CardBody, CardHeader, CardTitle, Container, PageHeader, PageSkeleton } from "@/components/ui";
import { VehicleImage } from "@/components/vehicle-image";
import { requireUser } from "@/lib/auth-session";
import { getVehicle } from "@/server/availability";
import { listBranches, listExtras } from "@/server/catalog";
import { getDriverProfile } from "@/server/files";
import { quoteRental, type Quote } from "@/server/pricing";
import { extrasQuery, readExtras } from "../book/extras-params";
import { toActionError } from "../_lib/service-errors";
import { readSearchForm, resolveSearch, windowQuery } from "../search/criteria";
import { DriverForm } from "./driver-form";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Checkout searchParams={searchParams} />
    </Suspense>
  );
}

/** One idempotency key per rendered checkout form; resubmits reuse it. */
function newCheckoutKey() {
  return `checkout-${randomUUID()}`;
}

async function Checkout({ searchParams }: Pick<PageProps<"/checkout">, "searchParams">) {
  const sp = await searchParams;
  const vehicleId = typeof sp.vehicle === "string" ? sp.vehicle : "";
  const back = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])));
  const user = await requireUser(`/checkout?${back.toString()}`);

  const data = await getVehicle(vehicleId);
  if (!data || data.vehicle.status === "RETIRED") notFound();
  const { vehicle, branch } = data;
  const [active, extras, profile] = await Promise.all([listBranches(), listExtras(), getDriverProfile(user.id)]);
  const branches = active.some((b) => b.id === branch.id) ? active : [branch, ...active];
  const form = readSearchForm({ ...sp, pickup: branch.code }, branches);
  const resolved = resolveSearch(form, branches, []);
  const chosen = readExtras(sp, extras);
  const wq = windowQuery(form);
  const eq = extrasQuery(chosen);
  const extrasHref = `/book/${vehicle.id}?${wq}${eq ? `&${eq}` : ""}`;

  let quote: Quote | null = null;
  let problem: string | undefined;
  if (resolved.ok) {
    try {
      quote = await quoteRental({
        vehicleId: vehicle.id,
        pickupBranchId: resolved.pickupBranch.id,
        returnBranchId: resolved.returnBranch.id,
        pickupAt: resolved.pickupAt,
        returnAt: resolved.returnAt,
        extras: chosen.map((c) => ({ extraId: c.extra.id, quantity: c.quantity })),
      });
    } catch (err) {
      problem = toActionError(err, "checkout.quote", { vehicleId: vehicle.id }).message;
    }
  } else {
    problem = "Your rental dates are missing or invalid.";
  }

  const hidden: Record<string, string> = {
    ...Object.fromEntries(new URLSearchParams(wq)),
    vehicle: vehicle.id,
    idempotencyKey: newCheckoutKey(),
  };
  for (const c of chosen) if (c.quantity > 1) hidden[`qty_${c.extra.code}`] = String(c.quantity);

  return (
    <Container className="py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href={extrasHref} className="hover:text-ink">
          ← Back to extras
        </Link>
      </nav>
      <PageHeader eyebrow="Step 2 of 3" title="Driver details" description="We'll hold the car for 15 minutes while you pay." />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardBody className="p-5 sm:p-6">
            {problem || !quote ? (
              <Alert tone="error" title="We can't continue with this booking">
                {problem} <Link href={`/vehicles/${vehicle.id}?${wq}`} className="underline">Choose other dates</Link>.
              </Alert>
            ) : (
              <DriverForm
                hidden={hidden}
                extras={chosen.map((c) => c.extra.code)}
                defaults={{
                  fullName: profile?.fullName ?? user.name,
                  email: user.email,
                  phone: profile?.phone ?? user.phone ?? "",
                  dateOfBirth: profile?.dateOfBirth ?? "",
                  nationality: profile?.nationality ?? "",
                  licenceNumber: profile?.licenceNumber ?? "",
                  licenceCountry: profile?.licenceCountry ?? "AE",
                  licenceExpiry: profile?.licenceExpiry ?? "",
                  hasLicenceOnFile: Boolean(profile?.licenceFileKey),
                }}
              />
            )}
          </CardBody>
        </Card>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader className="flex items-center gap-3">
              <VehicleImage vehicle={vehicle} className="h-14 w-24 shrink-0 rounded-lg" />
              <div>
                <CardTitle>
                  {vehicle.make} {vehicle.model}
                </CardTitle>
                {resolved.ok && (
                  <p className="text-xs text-muted">
                    {formatDateTime(resolved.pickupAt, resolved.pickupBranch.timeZone)} at {resolved.pickupBranch.name}
                    <br />
                    {formatDateTime(resolved.returnAt, resolved.returnBranch.timeZone)} at {resolved.returnBranch.name}
                  </p>
                )}
              </div>
            </CardHeader>
            <CardBody>{quote && <PriceBreakdown quote={quote} />}</CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
