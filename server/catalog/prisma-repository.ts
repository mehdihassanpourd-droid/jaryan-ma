import { ConflictError, NotFoundError, ValidationError } from "../../src/domain/errors";
import { tomanFromDbOrNull, tomanToDbOrNull } from "../../src/domain/money";
import { normalizeForSearch } from "../../src/domain/persian";
import type {
  CatalogRepository,
  CategoryRecord,
  ImportOutcome,
  ProductPage,
  ProductSummary,
} from "../../src/domain/product/ports";
import { searchTerms, type ProductListQuery } from "../../src/domain/product/query";
import type { ImportProductInput, ProductInput } from "../../src/domain/product/schema";
import type { Fulfillment, ProductListRow, ProductStatus, StoredProduct } from "../../src/domain/product/types";
import { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";

type Tx = Prisma.TransactionClient;

const FULL = { images: { orderBy: { position: "asc" } }, variants: { orderBy: { position: "asc" } } } satisfies Prisma.ProductInclude;
export const LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  fulfillment: true,
  categoryId: true,
  priceToman: true,
  inventory: true,
  leadTimeDays: true,
  version: true,
  updatedAt: true,
  publishedAt: true,
  images: { orderBy: { position: "asc" }, take: 1, select: { key: true, alt: true } },
  variants: { select: { priceToman: true, inventory: true } },
} satisfies Prisma.ProductSelect;

type FullRow = Prisma.ProductGetPayload<{ include: typeof FULL }>;
export type ListRow = Prisma.ProductGetPayload<{ select: typeof LIST_SELECT }>;

const ORDER_BY: Record<ProductListQuery["sort"], Prisma.ProductOrderByWithRelationInput[]> = {
  updated_desc: [{ updatedAt: "desc" }, { id: "desc" }],
  updated_asc: [{ updatedAt: "asc" }, { id: "asc" }],
  created_desc: [{ createdAt: "desc" }, { id: "desc" }],
  name_asc: [{ name: "asc" }, { id: "asc" }],
  price_asc: [{ priceToman: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  price_desc: [{ priceToman: { sort: "desc", nulls: "last" } }, { id: "desc" }],
};

const iso = (d: Date) => d.toISOString();

function toStored(p: FullRow): StoredProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    categoryId: p.categoryId,
    status: p.status,
    fulfillment: p.fulfillment,
    priceToman: tomanFromDbOrNull(p.priceToman),
    inventory: p.inventory,
    leadTimeDays: p.leadTimeDays,
    images: p.images.map((i) => ({ id: i.id, key: i.key, alt: i.alt, position: i.position })),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      options: v.options as Record<string, string>,
      priceToman: tomanFromDbOrNull(v.priceToman),
      inventory: v.inventory,
      position: v.position,
    })),
    version: p.version,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    publishedAt: p.publishedAt ? iso(p.publishedAt) : null,
  };
}

export function toListRow(p: ListRow): ProductListRow {
  const productPrice = tomanFromDbOrNull(p.priceToman);
  const effective = p.variants.map((v) => tomanFromDbOrNull(v.priceToman) ?? productPrice).filter((n): n is number => n !== null);
  const cover = p.images[0];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    fulfillment: p.fulfillment,
    categoryId: p.categoryId,
    priceToman: productPrice,
    inventory: p.inventory,
    leadTimeDays: p.leadTimeDays,
    coverKey: cover?.key ?? null,
    coverAlt: cover?.alt ?? null,
    variantCount: p.variants.length,
    variantMinPriceToman: effective.length > 0 ? Math.min(...effective) : null,
    variantAvailableCount: p.variants.filter((v) => p.fulfillment === "made_to_order" || (v.inventory ?? 0) > 0).length,
    version: p.version,
    updatedAt: iso(p.updatedAt),
    publishedAt: p.publishedAt ? iso(p.publishedAt) : null,
  };
}

/** Translates driver/ORM errors into the domain's own error types. */
function mapError(error: unknown): unknown {
  if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof ValidationError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const detail = `${error.message} ${JSON.stringify(error.meta ?? {})}`.toLowerCase();
    if (error.code === "P2002") {
      if (detail.includes("sku")) return new ConflictError("sku_taken");
      if (detail.includes("categories")) return new ConflictError("category_slug_taken");
      if (detail.includes("slug")) return new ConflictError("slug_taken");
    }
    if (error.code === "P2003") {
      const path = detail.includes("parent") ? "parentId" : "categoryId";
      return new ValidationError([{ path, code: "unknown_category" }]);
    }
    if (error.code === "P2025") return new NotFoundError();
  }
  return error;
}

const searchText = (input: ProductInput) =>
  normalizeForSearch([input.name, input.description, ...input.variants.map((v) => v.sku)].join(" "));

const imageRows = (input: ProductInput) => input.images.map((img, position) => ({ key: img.key, alt: img.alt, position }));
const variantRows = (input: ProductInput) =>
  input.variants.map((v, position) => ({
    sku: v.sku,
    options: v.options as Prisma.InputJsonValue,
    priceToman: tomanToDbOrNull(v.priceToman),
    inventory: v.inventory,
    position,
  }));

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/** PostgreSQL + Prisma implementation of the catalogue port: the production implementation. */
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(
    private readonly db: Db,
    private readonly vendorId: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private where(q: ProductListQuery, forceStatus?: readonly ProductStatus[]): Prisma.ProductWhereInput {
    const and: Prisma.ProductWhereInput[] = [
      { vendorId: this.vendorId },
      { status: { in: [...(forceStatus ?? q.status ?? ["draft", "published"])] } },
    ];
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.fulfillment) and.push({ fulfillment: q.fulfillment });
    if (q.minPrice !== undefined) and.push({ priceToman: { gte: BigInt(q.minPrice) } });
    if (q.maxPrice !== undefined) and.push({ priceToman: { lte: BigInt(q.maxPrice) } });
    // Stock lives on variants for variant products, so inventory is NULL there: express both
    // sides with explicit NULL handling instead of relying on NOT(NULL > 0).
    if (q.availability === "in_stock") {
      and.push({ OR: [{ fulfillment: "made_to_order" }, { inventory: { gt: 0 } }, { variants: { some: { inventory: { gt: 0 } } } }] });
    }
    if (q.availability === "out_of_stock") {
      and.push({
        fulfillment: { not: "made_to_order" },
        OR: [{ inventory: null }, { inventory: { lte: 0 } }],
        variants: { none: { inventory: { gt: 0 } } },
      });
    }
    for (const term of searchTerms(q.q)) and.push({ searchText: { contains: term } });
    return { AND: and };
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.db.product.count({ where: { slug } })) > 0;
  }

  async listProducts(query: ProductListQuery, forceStatus?: readonly ProductStatus[]): Promise<ProductPage> {
    const where = this.where(query, forceStatus);
    const [rows, total] = await this.db.$transaction([
      this.db.product.findMany({ where, orderBy: ORDER_BY[query.sort], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: LIST_SELECT }),
      this.db.product.count({ where }),
    ]);
    return { items: rows.map(toListRow), total, page: query.page, pageSize: query.pageSize };
  }

  async getProduct(id: string): Promise<StoredProduct | null> {
    const row = await this.db.product.findFirst({ where: { id, vendorId: this.vendorId }, include: FULL });
    return row ? toStored(row) : null;
  }

  async getProducts(ids: string[]): Promise<StoredProduct[]> {
    if (ids.length === 0) return [];
    if (ids.length > 100) throw new Error("too_many_ids");
    const rows = await this.db.product.findMany({ where: { id: { in: ids }, vendorId: this.vendorId }, include: FULL });
    return rows.map(toStored);
  }

  async getSummary(id: string): Promise<ProductSummary | null> {
    return this.db.product.findFirst({ where: { id, vendorId: this.vendorId }, select: { id: true, slug: true, status: true, categoryId: true } });
  }

  // ---- writes -------------------------------------------------------------------------------

  private async audit(tx: Tx, actor: string, action: string, entityId: string, detail: Prisma.InputJsonValue, at: Date) {
    await tx.auditLog.create({ data: { actorEmail: actor, action, entity: "product", entityId, detail, at } });
  }

  private async insert(tx: Tx, input: ProductInput & { slug: string }, actor: string, now: Date): Promise<string> {
    const created = await tx.product.create({
      data: {
        vendorId: this.vendorId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        categoryId: input.categoryId,
        status: input.status,
        fulfillment: input.fulfillment as Fulfillment,
        priceToman: tomanToDbOrNull(input.priceToman),
        inventory: input.inventory,
        leadTimeDays: input.leadTimeDays,
        searchText: searchText(input),
        createdAt: now,
        updatedAt: now,
        publishedAt: input.status === "published" ? now : null,
        images: { create: imageRows(input) },
        variants: { create: variantRows(input) },
      },
      select: { id: true },
    });
    await this.audit(tx, actor, "product.create", created.id, { slug: input.slug, status: input.status }, now);
    return created.id;
  }

  private async replace(tx: Tx, id: string, input: ProductInput, expectedVersion: number | null, actor: string, now: Date): Promise<void> {
    const current = await tx.product.findFirst({ where: { id, vendorId: this.vendorId }, select: { publishedAt: true } });
    if (!current) throw new NotFoundError();
    const updated = await tx.product.updateMany({
      where: expectedVersion === null ? { id } : { id, version: expectedVersion },
      data: {
        ...(input.slug ? { slug: input.slug } : {}),
        name: input.name,
        description: input.description,
        // undefined = the caller did not mention SEO text (older client, CSV without those columns): keep it.
        ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
        ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
        categoryId: input.categoryId,
        status: input.status,
        fulfillment: input.fulfillment as Fulfillment,
        priceToman: tomanToDbOrNull(input.priceToman),
        inventory: input.inventory,
        leadTimeDays: input.leadTimeDays,
        searchText: searchText(input),
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updated.count === 0) throw new ConflictError("version_conflict");
    if (input.status === "published" && current.publishedAt === null) {
      await tx.product.update({ where: { id }, data: { publishedAt: now } });
    }
    await tx.productImage.deleteMany({ where: { productId: id } });
    await tx.productVariant.deleteMany({ where: { productId: id } });
    await tx.productImage.createMany({ data: imageRows(input).map((r) => ({ ...r, productId: id })) });
    await tx.productVariant.createMany({ data: variantRows(input).map((r) => ({ ...r, productId: id })) });
    await this.audit(tx, actor, "product.update", id, { slug: input.slug ?? null, status: input.status }, now);
  }

  async createProduct(input: ProductInput & { slug: string }, actor: string): Promise<StoredProduct> {
    try {
      const id = await this.db.$transaction((tx) => this.insert(tx, input, actor, this.clock()), TX_OPTIONS);
      const created = await this.getProduct(id);
      if (!created) throw new NotFoundError();
      return created;
    } catch (error) {
      throw mapError(error);
    }
  }

  async updateProduct(id: string, input: ProductInput, expectedVersion: number | null, actor: string): Promise<StoredProduct> {
    try {
      await this.db.$transaction((tx) => this.replace(tx, id, input, expectedVersion, actor, this.clock()), TX_OPTIONS);
      const updated = await this.getProduct(id);
      if (!updated) throw new NotFoundError();
      return updated;
    } catch (error) {
      throw mapError(error);
    }
  }

  async importProducts(inputs: ImportProductInput[], actor: string): Promise<ImportOutcome> {
    if (inputs.length === 0) return { created: 0, updated: 0, affected: [] };
    try {
      return await this.db.$transaction(async (tx) => {
        const now = this.clock();
        const existing = new Map(
          (await tx.product.findMany({ where: { slug: { in: inputs.map((p) => p.slug) }, vendorId: this.vendorId }, select: { id: true, slug: true, categoryId: true } })).map((p) => [p.slug, p]),
        );
        const outcome: ImportOutcome = { created: 0, updated: 0, affected: [] };
        for (const input of inputs) {
          const found = existing.get(input.slug);
          if (found) {
            await this.replace(tx, found.id, input, null, actor, now);
            outcome.updated++;
            outcome.affected.push({ id: found.id, previousCategoryId: found.categoryId });
          } else {
            outcome.created++;
            outcome.affected.push({ id: await this.insert(tx, input, actor, now), previousCategoryId: null });
          }
        }
        return outcome;
      }, TX_OPTIONS);
    } catch (error) {
      throw mapError(error);
    }
  }

  async addImage(productId: string, key: string, alt: string, max: number, actor: string): Promise<boolean> {
    try {
      return await this.db.$transaction(async (tx) => {
        // A no-op UPDATE takes the row lock until the transaction ends, so concurrent uploads for the
        // same product are serialised and the limit cannot be exceeded (no raw SQL needed).
        const locked = await tx.product.updateMany({ where: { id: productId, vendorId: this.vendorId }, data: { version: { increment: 0 } } });
        if (locked.count === 0) throw new NotFoundError();
        const { _count, _max } = await tx.productImage.aggregate({ where: { productId }, _count: true, _max: { position: true } });
        if (_count >= max) return false;
        await tx.productImage.create({ data: { productId, key, alt, position: (_max.position ?? -1) + 1 } });
        await this.audit(tx, actor, "product.image.add", productId, { key }, this.clock());
        return true;
      }, TX_OPTIONS);
    } catch (error) {
      throw mapError(error);
    }
  }

  // ---- categories ---------------------------------------------------------------------------

  async listCategories(): Promise<CategoryRecord[]> {
    return this.db.category.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, slug: true, name: true, parentId: true, position: true } });
  }

  async listCategoryCounts() {
    const rows = await this.db.category.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, parentId: true, position: true, _count: { select: { products: { where: { status: "published", vendorId: this.vendorId } } } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, publishedCount: _count.products }));
  }

  async createCategory(input: { slug: string; name: string; parentId?: string | null }): Promise<CategoryRecord> {
    try {
      const { _max } = await this.db.category.aggregate({ _max: { position: true } });
      return await this.db.category.create({
        data: { slug: input.slug, name: input.name, parentId: input.parentId ?? null, position: (_max.position ?? -1) + 1 },
        select: { id: true, slug: true, name: true, parentId: true, position: true },
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async listPublishedRows(categoryId: string, limit: number): Promise<ProductListRow[]> {
    const rows = await this.db.product.findMany({
      where: { status: "published", categoryId, vendorId: this.vendorId },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: limit,
      select: LIST_SELECT,
    });
    return rows.map(toListRow);
  }
}
