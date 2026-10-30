"use client";

import { useEffect, useState } from "react";

/** Live "mm:ss left" for a reservation hold. Server remains the source of truth. */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const end = new Date(expiresAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return <span className="font-mono">--:--</span>;
  const left = Math.max(0, end - now);
  if (left === 0) return <span className="font-semibold text-red-700">expired</span>;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className="font-mono font-semibold tabular-nums" aria-live="off">
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}
