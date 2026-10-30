import { z } from "zod";
import { LocalFileStorage } from "./local-storage";
import type { FileStorage } from "./types";

export * from "./types";

const settings = z.object({
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_UPLOADS_DIR: z.string().default("./storage/uploads"),
});

export function createFileStorage(env: Record<string, string | undefined> = process.env): FileStorage {
  const s = settings.parse(env);
  switch (s.STORAGE_DRIVER) {
    case "local":
      return new LocalFileStorage(s.LOCAL_UPLOADS_DIR);
    case "s3":
      throw new Error("STORAGE_DRIVER=s3 is not implemented yet");
  }
}

const globalForStorage = globalThis as unknown as { fileStorage?: FileStorage };

export function getFileStorage(): FileStorage {
  globalForStorage.fileStorage ??= createFileStorage();
  return globalForStorage.fileStorage;
}
