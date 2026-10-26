import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "./local-disk";
import { MemoryStorage } from "./memory";
import { S3Storage, type S3Sender } from "./s3";

describe("MemoryStorage", () => {
  it("stores, reads and deletes objects", async () => {
    const s = new MemoryStorage();
    await s.put("a/b.json", '{"x":1}', { contentType: "application/json", cacheControl: "public" });
    expect(s.json("a/b.json")).toEqual({ x: 1 });
    expect(s.objects.get("a/b.json")).toMatchObject({ contentType: "application/json", cacheControl: "public" });
    await s.delete(["a/b.json", "missing"]);
    expect(s.has("a/b.json")).toBe(false);
  });
});

describe("LocalDiskStorage", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jm-storage-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes nested files, reads them back with a content type, and deletes", async () => {
    const s = new LocalDiskStorage(dir);
    await s.put("images/p1/a.webp", Uint8Array.from([1, 2, 3]), { contentType: "image/webp" });
    expect(await readFile(join(dir, "images/p1/a.webp"))).toEqual(Buffer.from([1, 2, 3]));
    expect(await s.read("images/p1/a.webp")).toMatchObject({ contentType: "image/webp" });
    await s.delete(["images/p1/a.webp"]);
    await expect(stat(join(dir, "images/p1/a.webp"))).rejects.toThrow();
    expect(await s.read("images/p1/a.webp")).toBeNull();
  });

  it.each(["../outside.json", "a/../../outside.json", "/etc/passwd", "a\0b.json"])("refuses the key %j", async (key) => {
    const s = new LocalDiskStorage(dir);
    await expect(s.put(key, "x", { contentType: "text/plain" })).rejects.toThrow("invalid_storage_key");
    await expect(s.delete([key])).rejects.toThrow("invalid_storage_key");
    expect(await s.read(key)).toBeNull();
  });

  it("serves only known media types", async () => {
    const s = new LocalDiskStorage(dir);
    await s.put("x.html", "<script>alert(1)</script>", { contentType: "text/html" });
    expect(await s.read("x.html")).toBeNull();
  });
});

describe("S3Storage", () => {
  function fake() {
    const sent: Array<PutObjectCommand | DeleteObjectsCommand> = [];
    const client: S3Sender = { send: async (c) => void sent.push(c) };
    return { sent, storage: new S3Storage(client, "my-bucket") };
  }

  it("puts objects with content type and cache headers", async () => {
    const { sent, storage } = fake();
    await storage.put("catalog/manifest.json", "{}", { contentType: "application/json", cacheControl: "public, max-age=30" });
    const cmd = sent[0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({ Bucket: "my-bucket", Key: "catalog/manifest.json", ContentType: "application/json", CacheControl: "public, max-age=30" });
    expect(cmd.input.Body).toEqual(new TextEncoder().encode("{}"));
  });

  it("deletes in batches of at most 1000 keys", async () => {
    const { sent, storage } = fake();
    await storage.delete(Array.from({ length: 2500 }, (_, i) => `k${i}`));
    expect(sent).toHaveLength(3);
    const sizes = sent.map((c) => (c as DeleteObjectsCommand).input.Delete?.Objects?.length);
    expect(sizes).toEqual([1000, 1000, 500]);
    expect((sent[0] as DeleteObjectsCommand).input).toMatchObject({ Bucket: "my-bucket" });
  });

  it("does nothing when there is nothing to delete", async () => {
    const { sent, storage } = fake();
    await storage.delete([]);
    expect(sent).toEqual([]);
  });
});
