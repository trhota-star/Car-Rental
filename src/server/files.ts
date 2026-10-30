import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getFileStorage, type FileStorage } from "@/lib/storage";
import { damageReports, driverProfiles, reservations } from "@/lib/db/schema";
import { db, isAdmin } from "./db";
import { parseInput, ServiceError } from "./errors";
import { log } from "./log";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const TYPES = {
  "image/jpeg": { ext: "jpg", magic: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": {
    ext: "webp",
    magic: (b: Uint8Array) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
  "application/pdf": { ext: "pdf", magic: (b: Uint8Array) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-" },
} as const;
type AllowedType = keyof typeof TYPES;
const IMAGE_TYPES: AllowedType[] = ["image/jpeg", "image/png", "image/webp"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Exactly `licences/<userId>/<uuid>.<ext>` (what uploadLicence returns). */
export const LICENCE_KEY_RE = new RegExp(`^licences/(${UUID})/${UUID}\.(jpg|png|webp|pdf)$`);
/** Exactly `damage/<vehicleId>/<uuid>.<ext>`. */
export const DAMAGE_KEY_RE = new RegExp(`^damage/(${UUID})/${UUID}\.(jpg|png|webp)$`);

export function isLicenceKeyFor(key: string, userId: string): boolean {
  const m = LICENCE_KEY_RE.exec(key);
  return !!m && m[1] === userId.toLowerCase();
}

function checkFile(data: Uint8Array, contentType: string, allowed: AllowedType[]): AllowedType {
  const type = contentType.toLowerCase().split(";")[0].trim() as AllowedType;
  if (!allowed.includes(type)) {
    throw new ServiceError("VALIDATION_ERROR", `Unsupported file type (allowed: ${allowed.join(", ")})`);
  }
  if (data.byteLength === 0) throw new ServiceError("VALIDATION_ERROR", "File is empty");
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new ServiceError("VALIDATION_ERROR", "File is larger than 5 MB");
  if (!TYPES[type].magic(data)) throw new ServiceError("VALIDATION_ERROR", "File content does not match its type");
  return type;
}

const uploadLicenceInput = z.object({
  userId: z.uuid(),
  data: z.instanceof(Uint8Array),
  contentType: z.string().min(1).max(100),
  filename: z.string().max(255).optional(),
});

/** Store a driving-licence scan privately. Pass the returned key as driver.licenceFileKey. */
export async function uploadLicence(
  input: z.input<typeof uploadLicenceInput>,
  opts: { storage?: FileStorage } = {},
): Promise<{ key: string; contentType: string; size: number }> {
  const i = parseInput(uploadLicenceInput, input);
  const type = checkFile(i.data, i.contentType, Object.keys(TYPES) as AllowedType[]);
  const key = `licences/${i.userId}/${randomUUID()}.${TYPES[type].ext}`;
  const stored = await (opts.storage ?? getFileStorage()).put(key, i.data, type);
  log.info("file.licence_uploaded", { userId: i.userId, key, size: stored.size });
  return { key, contentType: type, size: stored.size };
}

/** Store damage photos (admin services call this). Returns keys in order. */
export async function storeDamagePhotos(
  vehicleId: string,
  photos: { data: Uint8Array; contentType: string }[],
  storage: FileStorage = getFileStorage(),
): Promise<string[]> {
  if (photos.length > 10) throw new ServiceError("VALIDATION_ERROR", "At most 10 photos per report");
  const checked = photos.map((p) => ({ ...p, type: checkFile(p.data, p.contentType, IMAGE_TYPES) }));
  const keys: string[] = [];
  for (const p of checked) {
    const key = `damage/${vehicleId}/${randomUUID()}.${TYPES[p.type].ext}`;
    await storage.put(key, p.data, p.type);
    keys.push(key);
  }
  return keys;
}

/**
 * Return a private file if `viewerId` may see it, else null (respond 404).
 * - Licence: the owning user (key folder + referenced by their driver profile) or an ADMIN.
 * - Damage photo: an ADMIN, or the customer whose reservation the report belongs to.
 */
export async function getFileForViewer(
  input: { key: string; viewerId: string },
  opts: { storage?: FileStorage } = {},
): Promise<{ data: Buffer; contentType: string } | null> {
  const p = z.object({ key: z.string().max(300), viewerId: z.uuid() }).safeParse(input);
  if (!p.success) return null;
  const { key, viewerId } = p.data;
  let allowed = false;
  const lic = LICENCE_KEY_RE.exec(key);
  const dmg = DAMAGE_KEY_RE.exec(key);
  if (lic) {
    if (await isAdmin(db, viewerId)) allowed = true;
    else if (lic[1] === viewerId) {
      const [own] = await db
        .select({ id: driverProfiles.id })
        .from(driverProfiles)
        .where(and(eq(driverProfiles.userId, viewerId), eq(driverProfiles.licenceFileKey, key)));
      allowed = !!own;
    }
  } else if (dmg) {
    const [report] = await db
      .select({ ownerId: reservations.userId })
      .from(damageReports)
      .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
      .where(sql`${key} = ANY(${damageReports.imageKeys})`)
      .limit(1);
    if (report) allowed = report.ownerId === viewerId || (await isAdmin(db, viewerId));
  }
  if (!allowed) {
    log.info("file.denied", { viewerId, key });
    return null;
  }
  return (opts.storage ?? getFileStorage()).get(key);
}

export async function getDriverProfile(userId: string) {
  if (!z.uuid().safeParse(userId).success) return null;
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  return p ?? null;
}
