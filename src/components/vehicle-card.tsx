import Link from "next/link";
import type { Vehicle, VehicleCategory } from "@/lib/db/schema";
import { formatMoney, labelFor } from "./format";
import { VehicleImage } from "./vehicle-image";
import { Badge } from "./ui/badge";
import { buttonClass } from "./ui/button";

export function VehicleSpecs({ vehicle }: { vehicle: Pick<Vehicle, "seats" | "transmission" | "fuelType" | "luggage" | "doors"> }) {
  const items = [
    `${vehicle.seats} seats`,
    labelFor(vehicle.transmission),
    labelFor(vehicle.fuelType),
    `${vehicle.luggage} bags`,
    `${vehicle.doors} doors`,
  ];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i} className="flex items-center gap-1">
          <span className="size-1 rounded-full bg-slate-300" aria-hidden />
          {i}
        </li>
      ))}
    </ul>
  );
}

export function VehicleCard({
  vehicle,
  category,
  dailyRateFils,
  estimatedTotalFils,
  rentalDays,
  href,
}: {
  vehicle: Vehicle;
  category: VehicleCategory;
  dailyRateFils: number;
  estimatedTotalFils: number;
  rentalDays: number;
  href: string;
}) {
  return (
    <article
      data-testid="vehicle-card"
      data-vehicle-id={vehicle.id}
      className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-md"
    >
      <VehicleImage vehicle={vehicle} className="aspect-[16/9]" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-ink">
              {vehicle.make} {vehicle.model}
            </h3>
            <p className="text-xs text-muted">
              {vehicle.year}{vehicle.color ? ` · ${vehicle.color}` : ""}
            </p>
          </div>
          <Badge tone="brand">{category.name}</Badge>
        </div>
        <VehicleSpecs vehicle={vehicle} />
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3">
          <div>
            <p className="text-lg font-bold text-ink">
              {formatMoney(dailyRateFils)}
              <span className="text-xs font-normal text-muted"> / day</span>
            </p>
            <p className="text-xs text-muted">
              {formatMoney(estimatedTotalFils)} for {rentalDays} {rentalDays === 1 ? "day" : "days"} incl. VAT
            </p>
          </div>
          <Link href={href} className={buttonClass("primary", "sm")} aria-label={`View ${vehicle.make} ${vehicle.model}`}>
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
