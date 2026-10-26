import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import type { ObjectStorage } from "../../src/domain/product/ports";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Stores objects as files under a directory. For local development only (no S3 needed); the dev
 * server exposes it at /media. Keys are confined to the root: traversal attempts are rejected.
 */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (key.includes("\0") || key.startsWith("/") || key.split("/").includes("..")) throw new Error("invalid_storage_key");
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error("invalid_storage_key");
    return full;
  }

  /** Content type and cache headers are derived from the extension when serving, so options are unused here. */
  async put(key: string, body: Uint8Array | string, options?: { contentType: string; cacheControl?: string }) {
    void options;
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async delete(keys: string[]) {
    for (const key of keys) await rm(this.path(key), { force: true });
  }

  /** For the dev media route. Returns null for missing files and unsupported types. */
  async read(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const contentType = CONTENT_TYPES[extname(key).toLowerCase()];
    if (!contentType) return null;
    try {
      return { body: await readFile(this.path(key)), contentType };
    } catch {
      return null;
    }
  }
}
