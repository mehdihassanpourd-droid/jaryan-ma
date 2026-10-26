import type { ObjectStorage } from "../../src/domain/product/ports";

/** In-memory object store for tests. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string; cacheControl?: string }>();

  async put(key: string, body: Uint8Array | string, options: { contentType: string; cacheControl?: string }) {
    this.objects.set(key, { body: typeof body === "string" ? new TextEncoder().encode(body) : body, ...options });
  }

  async delete(keys: string[]) {
    for (const key of keys) this.objects.delete(key);
  }

  has(key: string) {
    return this.objects.has(key);
  }

  text(key: string): string | undefined {
    const o = this.objects.get(key);
    return o ? new TextDecoder().decode(o.body) : undefined;
  }

  json(key: string): unknown {
    const text = this.text(key);
    return text === undefined ? undefined : JSON.parse(text);
  }
}
