import { Badge, type BadgeTone } from "./ui/badge";
import { labelFor } from "./format";

const tones: Record<string, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "success",
  PICKED_UP: "brand",
  RETURNED: "neutral",
  CANCELLED: "danger",
  EXPIRED: "neutral",
  REFUNDED: "neutral",
  SUCCEEDED: "success",
  FAILED: "danger",
  AUTHORIZED: "brand",
  RELEASED: "neutral",
  CAPTURED: "warning",
  PARTIALLY_REFUNDED: "warning",
  AVAILABLE: "success",
  RESERVED: "brand",
  ON_RENT: "brand",
  MAINTENANCE: "warning",
  RETIRED: "neutral",
  OPEN: "warning",
  RESOLVED: "success",
};

const overrides: Record<string, string> = {
  PENDING: "Awaiting payment",
  ON_RENT: "On rent",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={tones[status] ?? "neutral"} data-status={status}>
      {label ?? overrides[status] ?? labelFor(status)}
    </Badge>
  );
}
