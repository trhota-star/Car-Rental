import { z } from "zod";
import { LocalFileStorage } from "./local-storage";
import type { FileStorage } from "./types";
import { VercelBlobStorage } from "./vercel-blob-storage";

export * from "./types";

const settings = z.object({
  // local       = private folder on disk (default)
  // vercel-blob = Vercel Blob, private access (UNVERIFIED until cloud links exist)
  STORAGE_DRIVER: z.enum(["local", "vercel-blob", "s3"]).default("local"),
  LOCAL_UPLOADS_DIR: z.string().default("./storage/uploads"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  BLOB_PATH_PREFIX: z.string().optional(),
});

export function createFileStorage(env: Record<string, string | undefined> = process.env): FileStorage {
  const s = settings.parse(env);
  switch (s.STORAGE_DRIVER) {
    case "local":
      return new LocalFileStorage(s.LOCAL_UPLOADS_DIR);
    case "vercel-blob":
      if (!s.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
      return new VercelBlobStorage({ token: s.BLOB_READ_WRITE_TOKEN, prefix: s.BLOB_PATH_PREFIX });
    case "s3":
      throw new Error("STORAGE_DRIVER=s3 is not implemented; use vercel-blob");
  }
}

const globalForStorage = globalThis as unknown as { fileStorage?: FileStorage };

export function getFileStorage(): FileStorage {
  globalForStorage.fileStorage ??= createFileStorage();
  return globalForStorage.fileStorage;
}
