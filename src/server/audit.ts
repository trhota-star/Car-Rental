import "server-only";
import { auditLogs } from "@/lib/db/schema";
import type { Executor } from "./db";

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

/** Append an audit row. Call inside the same transaction as the change it describes. */
export async function writeAudit(ex: Executor, entry: AuditEntry): Promise<void> {
  await ex.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: entry.data ?? {},
  });
}
