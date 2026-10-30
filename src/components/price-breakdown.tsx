import { formatMoney, labelFor } from "./format";

/** The fields of a server quote (or a reservation's price snapshot) that we display. */
export interface PriceSummary {
  currency: string;
  rentalDays: number;
  dailyRateFils: number;
  baseFils: number;
  extras: Array<{ extraId: string; name: string; pricing: string; quantity: number; unitPriceFils: number; totalFils: number }>;
  extrasFils: number;
  oneWayFeeFils: number;
  subtotalFils: number;
  vatRateBp: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
}

/** Server-computed quote rendered line by line. No arithmetic happens here. */
export function PriceBreakdown({
  quote,
  title = "Price breakdown",
  totalLabel = "Total to pay now",
}: {
  quote: PriceSummary;
  title?: string;
  totalLabel?: string;
}) {
  const c = quote.currency;
  const vatPercent = (quote.vatRateBp / 100).toLocaleString("en-AE", { maximumFractionDigits: 2 });
  return (
    <section aria-labelledby="price-breakdown-title" className="space-y-3">
      <h2 id="price-breakdown-title" className="text-base font-semibold">
        {title}
      </h2>
      <dl className="space-y-2 text-sm">
        <Row label="Daily rate" value={formatMoney(quote.dailyRateFils, c)} testId="price-daily-rate" />
        <Row label="Number of days" value={String(quote.rentalDays)} testId="price-days" />
        <Row
          label={`Rental (${quote.rentalDays} × ${formatMoney(quote.dailyRateFils, c)})`}
          value={formatMoney(quote.baseFils, c)}
          testId="price-base"
        />
        {quote.extras.map((e) => (
          <Row
            key={e.extraId}
            label={`${e.name}${e.quantity > 1 ? ` × ${e.quantity}` : ""} (${formatMoney(e.unitPriceFils, c)} ${labelFor(e.pricing)})`}
            value={formatMoney(e.totalFils, c)}
          />
        ))}
        {quote.extras.length > 0 && <Row label="Extras total" value={formatMoney(quote.extrasFils, c)} testId="price-extras" />}
        <Row
          label="One-way fee"
          value={quote.oneWayFeeFils > 0 ? formatMoney(quote.oneWayFeeFils, c) : "None"}
          testId="price-one-way"
        />
        <div className="border-t border-line pt-2">
          <Row label="Subtotal" value={formatMoney(quote.subtotalFils, c)} testId="price-subtotal" />
        </div>
        <Row label={`VAT (${vatPercent}%)`} value={formatMoney(quote.vatFils, c)} testId="price-vat" />
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="text-base font-semibold">{totalLabel}</dt>
          <dd className="text-xl font-bold text-ink" data-testid="price-total">
            {formatMoney(quote.totalFils, c)}
          </dd>
        </div>
      </dl>
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted">Security deposit (held, not charged)</span>
          <span className="font-medium" data-testid="price-deposit">
            {formatMoney(quote.depositFils, c)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">Released after the car is returned without damage.</p>
      </div>
    </section>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right font-medium tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
