import "server-only";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Structured server log line (one JSON object per line). Never pass secrets,
 * passwords, tokens or full card/licence data in `fields`.
 */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, code: (v as { code?: unknown }).code } : v,
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
