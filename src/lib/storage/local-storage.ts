import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage, StoredFile } from "./types";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const META_SUFFIX = ".meta.json";

/**
 * Stores files in a private folder on disk. Files are never served directly;
 * the app must read them through this class after checking permissions.
 */
export class LocalFileStorage implements FileStorage {
  readonly name = "local";
  readonly root: string;

  constructor(dir: string, projectRoot: string = process.cwd()) {
    this.root = path.resolve(projectRoot, dir);
    const publicDir = path.resolve(projectRoot, "public");
    const rel = path.relative(publicDir, this.root);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new Error(`Uploads folder must not be inside public/: ${this.root}`);
    }
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<StoredFile> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    await writeFile(file + META_SUFFIX, JSON.stringify({ contentType }));
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string) {
    const file = this.resolve(key);
    try {
      const [data, meta] = await Promise.all([readFile(file), readFile(file + META_SUFFIX, "utf8")]);
      return { data, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(key))).isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(file + META_SUFFIX, { force: true });
  }

  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split("/").some((p) => p === "." || p === "..") || key.endsWith(META_SUFFIX)) {
      throw new Error(`Invalid storage key "${key}"`);
    }
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key "${key}"`);
    return file;
  }
}
