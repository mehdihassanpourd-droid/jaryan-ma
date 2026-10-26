import { describe, expect, it } from "vitest";
import { parseProductCsv, productsToCsvRows, PRODUCT_CSV_COLUMNS, toCsv } from "./csv";
import { storedProduct } from "./fixtures";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, validateProductInput } from "./schema";
import { serializeSnapshot, toPublicProduct } from "./snapshot";

const base = { name: "اثر آزمایشی", fulfillment: "unique" };
const seo = (raw: Record<string, unknown>) => validateProductInput({ ...base, ...raw });

describe("SEO title and description on a product", () => {
  it("are optional: absent stays undefined (leave as is), blank becomes null (clear), text is kept", () => {
    const absent = seo({});
    expect(absent.ok && absent.value.seoTitle).toBeUndefined();
    const blank = seo({ seoTitle: "   ", seoDescription: "" });
    expect(blank.ok && [blank.value.seoTitle, blank.value.seoDescription]).toEqual([null, null]);
    const set = seo({ seoTitle: "  دیوارکوب بافته دستی ", seoDescription: "توضیح كوتاه" });
    expect(set.ok && [set.value.seoTitle, set.value.seoDescription]).toEqual(["دیوارکوب بافته دستی", "توضیح کوتاه"]);
    expect((seo({ seoTitle: null }) as { ok: true; value: { seoTitle: null } }).value.seoTitle).toBeNull();
  });

  it("enforces the length limits that search engines display", () => {
    expect(seo({ seoTitle: "ا".repeat(SEO_TITLE_MAX) }).ok).toBe(true);
    expect(seo({ seoTitle: "ا".repeat(SEO_TITLE_MAX + 1) })).toMatchObject({ ok: false, issues: [{ path: "seoTitle" }] });
    expect(seo({ seoDescription: "ا".repeat(SEO_DESCRIPTION_MAX) }).ok).toBe(true);
    expect(seo({ seoDescription: "ا".repeat(SEO_DESCRIPTION_MAX + 1) })).toMatchObject({ ok: false, issues: [{ path: "seoDescription" }] });
    expect(seo({ seoTitle: 5 }).ok).toBe(false);
  });
});

describe("public snapshot", () => {
  const ctx = { imageBaseUrl: "https://img.example.test", categoryById: new Map([["c1", { slug: "c", name: "دسته" }]]) };

  it("carries the editor's SEO text (and null when there is none)", () => {
    expect(toPublicProduct(storedProduct({ seoTitle: "عنوان", seoDescription: "شرح" }), ctx)).toMatchObject({ seoTitle: "عنوان", seoDescription: "شرح" });
    expect(toPublicProduct(storedProduct(), ctx)).toMatchObject({ seoTitle: null, seoDescription: null });
    expect(serializeSnapshot(toPublicProduct(storedProduct({ seoTitle: "عنوان" }), ctx))).toContain('"seoTitle":"عنوان"');
  });
});

describe("CSV", () => {
  const categoryIdBySlug = new Map([["c", "c1"]]);
  const header = (...extra: string[]) => [...PRODUCT_CSV_COLUMNS.filter((c) => !c.startsWith("seo_")), ...extra];
  const row = (cells: Record<string, string>, columns: string[]) => columns.map((c) => cells[c] ?? "");
  const cells = { slug: "اثر-یک", name: "اثر یک", fulfillment: "unique", price_toman: "1000", inventory: "1" };

  it("exports the SEO columns last, so older files keep their column positions", () => {
    expect(PRODUCT_CSV_COLUMNS.slice(-2)).toEqual(["seo_title", "seo_description"]);
    const [head, line] = productsToCsvRows([storedProduct({ seoTitle: "=عنوان", seoDescription: "شرح" })], new Map([["c1", "c"]]));
    expect(head).toEqual([...PRODUCT_CSV_COLUMNS]);
    expect(line?.[head!.indexOf("seo_title")]).toBe("'=عنوان"); // formula-injection protection applies here too
    expect(line?.[head!.indexOf("seo_description")]).toBe("شرح");
  });

  it("a file WITHOUT the columns leaves the stored SEO text alone (undefined), a file WITH them sets or clears it", () => {
    const without = parseProductCsv(toCsv([header(), row(cells, header())]), { categoryIdBySlug });
    expect(without.issues).toEqual([]);
    expect(without.products[0]?.seoTitle).toBeUndefined();

    const withCols = header("seo_title", "seo_description");
    const set = parseProductCsv(toCsv([withCols, row({ ...cells, seo_title: "عنوان سئو", seo_description: "شرح سئو" }, withCols)]), { categoryIdBySlug });
    expect(set.products[0]).toMatchObject({ seoTitle: "عنوان سئو", seoDescription: "شرح سئو" });
    const clear = parseProductCsv(toCsv([withCols, row(cells, withCols)]), { categoryIdBySlug });
    expect(clear.products[0]).toMatchObject({ seoTitle: null, seoDescription: null });
  });

  it("rejects over-long SEO text with a row-level issue", () => {
    const cols = header("seo_title");
    const result = parseProductCsv(toCsv([cols, row({ ...cells, seo_title: "ا".repeat(SEO_TITLE_MAX + 1) }, cols)]), { categoryIdBySlug });
    expect(result.products).toEqual([]);
    expect(result.issues[0]).toMatchObject({ row: 2, field: "seoTitle" });
  });
});
