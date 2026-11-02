import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptFile, MANIFEST_VERSION, sha256File, verifyBackup, type BackupManifest } from "./backup-tools";

const now = new Date("2026-03-10T12:00:00Z");
let dir: string;
beforeAll(async () => void (dir = await mkdtemp(join(tmpdir(), "jm-verify-"))));
afterAll(async () => rm(dir, { recursive: true, force: true }));

/** A backup-shaped pair of files. The "dump" is junk, so `pg_restore --list` rejects it: these tests cover everything before that step. */
async function fixture(name: string, over: Partial<BackupManifest> = {}, encryptWith?: Buffer) {
  const raw = join(dir, `${name}.dump`);
  await writeFile(raw, "not a real pg dump " + "x".repeat(1000));
  let file = raw;
  if (encryptWith) {
    file = `${raw}.enc`;
    await encryptFile(raw, file, encryptWith);
  }
  const manifest: BackupManifest = { version: MANIFEST_VERSION, takenAt: new Date(now.getTime() - 3600_000).toISOString(), tables: { orders: 2 }, migrations: ["0001"], dumpSha256: await sha256File(file), encrypted: Boolean(encryptWith), ...over };
  const manifestFile = join(dir, `${name}.manifest.json`);
  await writeFile(manifestFile, JSON.stringify(manifest));
  return { file, manifestFile };
}

describe("verifyBackup (offline)", () => {
  it("passes the checksum level for an encrypted backup when no key is given, and says what it did not check", async () => {
    const f = await fixture("enc-nokey", {}, randomBytes(32));
    const r = await verifyBackup({ ...f, now });
    expect(r).toMatchObject({ ok: true, level: "checksum" });
    expect(r.notes.join(" ")).toContain("not opened");
  });

  it("fails when the manifest is missing, malformed or has no tables", async () => {
    const f = await fixture("m1");
    expect(await verifyBackup({ file: f.file, manifestFile: join(dir, "nope.json"), now })).toMatchObject({ ok: false, level: "failed" });
    await writeFile(f.manifestFile, "{not json");
    expect(await verifyBackup({ ...f, now })).toMatchObject({ ok: false });
    const g = await fixture("m2", { tables: {} });
    expect((await verifyBackup({ ...g, now })).notes.join(" ")).toContain("no tables");
    const h = await fixture("m3", { version: 99 });
    expect((await verifyBackup({ ...h, now })).notes.join(" ")).toContain("unexpected format");
  });

  it("fails for a missing, empty, modified or truncated file", async () => {
    const f = await fixture("c1");
    expect(await verifyBackup({ file: join(dir, "gone.dump"), manifestFile: f.manifestFile, now })).toMatchObject({ ok: false });
    await writeFile(f.file, "");
    expect((await verifyBackup({ ...f, now })).notes.join(" ")).toContain("empty");
    await writeFile(f.file, "tampered");
    expect((await verifyBackup({ ...f, now })).notes.join(" ")).toContain("checksum does not match");
  });

  it("fails a backup that is too old, with the limit configurable", async () => {
    const f = await fixture("old", { takenAt: new Date(now.getTime() - 40 * 3600_000).toISOString() }, randomBytes(32));
    expect((await verifyBackup({ ...f, now })).notes.join(" ")).toContain("older than 36 hours");
    expect((await verifyBackup({ ...f, now, maxAgeHours: 48 })).ok).toBe(true);
    const bad = await fixture("badtime", { takenAt: "yesterday" });
    expect((await verifyBackup({ ...bad, now })).notes.join(" ")).toContain("no valid backup time");
  });

  it("fails on a wrong key and leaves no decrypted copy behind", async () => {
    const key = randomBytes(32);
    const f = await fixture("enc-key", {}, key);
    const wrong = await verifyBackup({ ...f, now, encryptionKey: randomBytes(32).toString("base64") });
    expect(wrong).toMatchObject({ ok: false, level: "failed" });
    expect(wrong.notes.join(" ")).toContain("could not decrypt");
    await verifyBackup({ ...f, now, encryptionKey: key.toString("base64") }); // right key, junk dump: fails at the structure step
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects a dump whose structure pg_restore cannot read, or notes that the tool is absent (never a false 'full')", async () => {
    const key = randomBytes(32);
    const f = await fixture("junk", {}, key);
    const r = await verifyBackup({ ...f, now, encryptionKey: key.toString("base64") });
    expect(r.level).not.toBe("full");
    if (r.level === "failed") expect(r.notes.join(" ")).toContain("cannot read the dump structure");
    else expect(r.notes.join(" ")).toContain("pg_restore is not installed");
  });
});
