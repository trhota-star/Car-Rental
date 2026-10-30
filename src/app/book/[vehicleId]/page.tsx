import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatDateTime } from "@/components/format";
import { PriceBreakdown } from "@/components/price-breakdown";
import { Alert, ButtonLink, Card, CardBody, CardHeader, CardTitle, Container, PageHeader, PageSkeleton } from "@/components/ui";
import { VehicleImage } from "@/components/vehicle-image";
import { getVehicle } from "@/server/availability";
import { listBranches, listExtras } from "@/server/catalog";
import { quoteRental, type Quote } from "@/server/pricing";
import { toActionError } from "../../_lib/service-errors";
import { readSearchForm, resolveSearch, windowQuery } from "../../search/criteria";
import { extrasQuery, readExtras } from "../extras-params";
import { ExtrasForm } from "./extras-form";

export const metadata: Metadata = { title: "Choose extras" };

export default function BookPage(props: PageProps<"/book/[vehicleId]">) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} />}>
      <Book {...props} />
    </Suspense>
  );
}

async function Book({ params, searchParams }: PageProps<"/book/[vehicleId]">) {
  const { vehicleId } = await params;
  const sp = await searchParams;
  const data = await getVehicle(vehicleId);
  if (!data || data.vehicle.status === "RETIRED") notFound();
  const { vehicle, branch } = data;

  const [active, extras] = await Promise.all([listBranches(), listExtras()]);
  const branches = active.some((b) => b.id === branch.id) ? active : [branch, ...active];
  const form = readSearchForm({ ...sp, pickup: branch.code }, branches);
  const resolved = resolveSearch(form, branches, []);
  const chosen = readExtras(sp, extras);
  const wq = windowQuery(form);
  const backHref = `/vehicles/${vehicle.id}?${wq}`;

  if (!resolved.ok) {
    return (
      <Container className="py-8">
        <Alert tone="warning" title="Choose your dates first">
          <Link href={backHref} className="underline">
            Go back to the car
          </Link>{" "}
          and pick valid rental dates.
        </Alert>
      </Container>
    );
  }

  let quote: Quote | null = null;
  let problem: string | undefined;
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
    problem = toActionError(err, "book.quote", { vehicleId: vehicle.id }).message;
  }

  const hidden = Object.fromEntries(new URLSearchParams(wq));
  const eq = extrasQuery(chosen);
  const checkoutHref = `/checkout?vehicle=${vehicle.id}&${wq}${eq ? `&${eq}` : ""}`;

  return (
    <Container className="py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href={backHref} className="hover:text-ink">
          ← Back to {vehicle.make} {vehicle.model}
        </Link>
      </nav>
      <PageHeader eyebrow="Step 1 of 3" title="Choose extras" description="Add anything you need. Prices update instantly." />
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardBody>
            {extras.length === 0 ? (
              <p className="text-sm text-muted">No extras are offered at the moment.</p>
            ) : (
              <ExtrasForm
                action={`/book/${vehicle.id}`}
                hidden={hidden}
                options={extras.map((x) => {
                  const c = chosen.find((ch) => ch.extra.id === x.id);
                  return {
                    code: x.code,
                    name: x.name,
                    description: x.description,
                    pricing: x.pricing,
                    priceFils: x.priceFils,
                    maxChargeFils: x.maxChargeFils,
                    maxQuantity: x.maxQuantity,
                    selected: Boolean(c),
                    quantity: c?.quantity ?? 1,
                  };
                })}
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
                <p className="text-xs text-muted">
                  {formatDateTime(resolved.pickupAt, resolved.pickupBranch.timeZone)} at {resolved.pickupBranch.name}
                  <br />
                  {formatDateTime(resolved.returnAt, resolved.returnBranch.timeZone)} at {resolved.returnBranch.name}
                </p>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              {problem && <Alert tone="error">{problem}</Alert>}
              {quote && (
                <>
                  <PriceBreakdown quote={quote} />
                  <ButtonLink href={checkoutHref} size="lg" className="w-full">
                    Continue to checkout
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
