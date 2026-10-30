// Vercel Blob driver (STORAGE_DRIVER=vercel-blob).
// UNVERIFIED: written against @vercel/blob 2.8 types only; never run against a real Blob store
// (no cloud account yet). Blobs are stored with access "private" and are only read server-side
// through this class after the app's permission checks (src/server/files.ts).
import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { FileStorage, StoredFile } from "./types";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class VercelBlobStorage implements FileStorage {
  readonly name = "vercel-blob";

  /** `token` defaults to BLOB_READ_WRITE_TOKEN (read by the SDK). `prefix` separates environments. */
  constructor(private readonly opts: { token?: string; prefix?: string } = {}) {}

  private path(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split("/").some((p) => p === "." || p === "..")) {
      throw new Error(`Invalid storage key "${key}"`);
    }
    return this.opts.prefix ? `${this.opts.prefix.replace(/\/+$/, "")}/${key}` : key;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<StoredFile> {
    await put(this.path(key), Buffer.from(data), {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: this.opts.token,
    });
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    const res = await get(this.path(key), { access: "private", useCache: false, token: this.opts.token });
    if (!res || res.statusCode !== 200) return null;
    const data = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { data, contentType: res.blob.contentType };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(this.path(key), { token: this.opts.token });
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await del(this.path(key), { token: this.opts.token });
  }
}
