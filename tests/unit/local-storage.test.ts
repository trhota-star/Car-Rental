import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileStorage } from "@/lib/storage";
import { LocalFileStorage } from "@/lib/storage/local-storage";

let project: string;
let storage: LocalFileStorage;

beforeEach(async () => {
  project = await mkdtemp(path.join(os.tmpdir(), "driveeasy-storage-"));
  storage = new LocalFileStorage("storage/uploads", project);
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("LocalFileStorage", () => {
  it("stores, reads and deletes a file with its content type", async () => {
    const bytes = new TextEncoder().encode("licence scan");
    expect(await storage.put("licences/user-1/front.png", bytes, "image/png")).toEqual({
      key: "licences/user-1/front.png",
      size: bytes.byteLength,
      contentType: "image/png",
    });
    expect(await storage.exists("licences/user-1/front.png")).toBe(true);
    const file = await storage.get("licences/user-1/front.png");
    expect(file?.contentType).toBe("image/png");
    expect(file?.data.toString()).toBe("licence scan");
    await storage.delete("licences/user-1/front.png");
    expect(await storage.get("licences/user-1/front.png")).toBeNull();
  });

  it("rejects keys that escape the uploads folder", async () => {
    for (const key of ["../secret", "a/../../b", "/etc/passwd", "C:\\x", "a//b", ".env", "x.meta.json"]) {
      await expect(storage.put(key, new Uint8Array([1]), "text/plain")).rejects.toThrow(/Invalid storage key/);
    }
  });

  it("refuses an uploads folder inside public/", () => {
    expect(() => new LocalFileStorage("public/uploads", project)).toThrow(/must not be inside public/);
    expect(() => new LocalFileStorage("public", project)).toThrow(/must not be inside public/);
  });

  it("is chosen by STORAGE_DRIVER", () => {
    expect(createFileStorage({ STORAGE_DRIVER: "local" }).name).toBe("local");
    expect(() => createFileStorage({ STORAGE_DRIVER: "s3" })).toThrow(/not implemented/);
  });
});
