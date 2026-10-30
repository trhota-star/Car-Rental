import "server-only";

type Level = "debug" | "info" | "warn" | "error";

/** Structured JSON logs: one JSON object per line. */
function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields }, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, code: (v as { code?: unknown }).code } : v,
  );
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
