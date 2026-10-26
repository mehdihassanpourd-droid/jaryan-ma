import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateProductInput } from "../../src/domain/product/schema";
import { PrismaCatalogRepository } from "../../server/catalog/prisma-repository";
import { CatalogService } from "../../server/catalog/service";
import { SnapshotPublisher } from "../../server/catalog/snapshot-publisher";
import { createTestDatabase } from "../../server/db/test-database";
import { ensureDefaultVendor } from "../../server/db/vendor";
import { MemoryStorage } from "../../server/storage/memory";

/**
 * Creates a small catalogue through the real backend stack (PostgreSQL via Prisma, catalogue service, snapshot
 * publisher) and writes the PUBLISHED snapshot files to a directory, exactly as they would sit in the bucket.
 * Used to build and verify the static site against realistic data without any cloud service.
 *
 *   npx tsx scripts/seo/generate-fixture.ts <output-dir>
 */
const target = process.argv[2];
if (!target) {
  console.error("usage: generate-fixture.ts <output-dir>");
  process.exit(64);
}
const outDir: string = target;

async function main() {
  const testDb = await createTestDatabase();
  try {
    const repo = new PrismaCatalogRepository(testDb.db, await ensureDefaultVendor(testDb.db));
    const service = new CatalogService(repo);
    const storage = new MemoryStorage();
    const publisher = new SnapshotPublisher(repo, storage, "https://media.fixture.example");
    const walls = (await repo.createCategory({ slug: "دیوارکوب", name: "دیوارکوب بافته" })).id;
    const macrame = (await repo.createCategory({ slug: "ماکرومه", name: "ماکرومه" })).id;
    await repo.createCategory({ slug: "خالی", name: "دسته خالی" });

    const add = async (raw: Record<string, unknown>, status: "published" | "draft" = "published") => {
      const parsed = validateProductInput({ fulfillment: "unique", ...raw });
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      let p = await service.create({ ...parsed.value, status: "draft" }, "fixture");
      if (status === "published") p = await service.setStatus(p.id, "published", p.version, "fixture");
      await publisher.sync([{ id: p.id }]);
    };
    const img = (n: string, alt = "") => ({ key: `images/p${n}/1.webp`, alt });

    await add({ name: "دیوارکوب بافته پاییزی", description: "این دیوارکوب با ریشه‌های بلند بافته شده و برای دیوار اتاق نشیمن در نظر گرفته شده است. جزئیات بافت در تصویر نزدیک دیده می‌شود.", categoryId: walls, priceToman: 4_500_000, images: [img("1", "دیوارکوب پاییزی روی دیوار"), { key: "images/p1/2.webp", alt: "" }] });
    await add({ name: "ماکرومه قوسی", categoryId: macrame, priceToman: 1_200_000, images: [img("2")] });
    await add({ name: "ماکرومه قوسی", categoryId: macrame, priceToman: 900_000, images: [img("3", "ماکرومه قوسی کوچک")] });
    await add({ name: "رانر سفارشی", fulfillment: "made_to_order", leadTimeDays: 21, categoryId: walls, priceToman: 2_000_000, images: [img("4", "رانر")] });
    await add({ name: "کوسن بافته", fulfillment: "stocked", categoryId: walls, variants: [{ sku: "K-S", options: { size: "S" }, inventory: 2, priceToman: 500_000 }, { sku: "K-L", options: { size: "L" }, inventory: 0, priceToman: 800_000 }], images: [img("5", "کوسن")] });
    await add({ name: "اثر فروخته‌شده", categoryId: walls, inventory: 0, priceToman: 1_000_000, images: [img("6", "اثر")] });
    await add({ name: "پیش‌نویس نباید دیده شود", categoryId: walls }, "draft");

    await rm(outDir, { recursive: true, force: true });
    for (const [key, object] of storage.objects) {
      const file = join(outDir, key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, object.body);
    }
    console.log(`Wrote ${storage.objects.size} snapshot files to ${outDir}`);
  } finally {
    await testDb.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
