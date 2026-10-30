import type { Vehicle } from "@/lib/db/schema";
import { cn } from "./ui/cn";

const colorMap: Record<string, string> = {
  white: "#e2e8f0",
  black: "#1e293b",
  silver: "#94a3b8",
  grey: "#64748b",
  gray: "#64748b",
  red: "#dc2626",
  blue: "#2563eb",
  green: "#16a34a",
  yellow: "#eab308",
  orange: "#ea580c",
  brown: "#78350f",
  beige: "#d6c7a1",
  gold: "#ca8a04",
};

/** Vehicle photo when one is configured, otherwise a tinted illustration. */
export function VehicleImage({
  vehicle,
  className,
}: {
  vehicle: Pick<Vehicle, "make" | "model" | "imageUrl" | "color">;
  className?: string;
}) {
  const alt = `${vehicle.make} ${vehicle.model}`;
  if (vehicle.imageUrl && /^(https?:\/\/|\/)/.test(vehicle.imageUrl)) {
    return (
      <div className={cn("overflow-hidden bg-slate-100", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- admin-provided URLs from any host */}
        <img src={vehicle.imageUrl} alt={alt} className="size-full object-cover" loading="lazy" />
      </div>
    );
  }
  const fill = colorMap[(vehicle.color ?? "").toLowerCase().split(" ").pop() ?? ""] ?? "#338bfc";
  return (
    <div
      role="img"
      aria-label={alt}
      className={cn("flex items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100", className)}
    >
      <svg viewBox="0 0 200 90" className="w-3/4 drop-shadow-sm" aria-hidden>
        <path
          d="M18 62c0-8 4-13 13-15l25-6 22-17c5-4 10-5 16-5h36c7 0 12 2 17 7l17 17 18 4c7 2 11 7 11 13v7c0 3-2 5-5 5H23c-3 0-5-2-5-5v-5Z"
          fill={fill}
          stroke="#0f172a"
          strokeOpacity=".25"
          strokeWidth="2"
        />
        <path d="M84 28c3-3 7-4 11-4h17v19H66l18-15Zm34-4h18c5 0 8 1 11 4l14 15h-43V24Z" fill="#e0f2fe" opacity=".9" />
        <circle cx="55" cy="72" r="13" fill="#1e293b" />
        <circle cx="55" cy="72" r="6" fill="#cbd5e1" />
        <circle cx="152" cy="72" r="13" fill="#1e293b" />
        <circle cx="152" cy="72" r="6" fill="#cbd5e1" />
      </svg>
    </div>
  );
}
