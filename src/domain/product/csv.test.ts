import { describe, expect, it } from "vitest";
import {
  MAX_CSV_CHARS,
  PRODUCT_CSV_COLUMNS,
  parseCsv,
  parseProductCsv,
  productsToCsvRows,
  protectCell,
  toCsv,
  unprotectCell,
} from "./csv";
import { storedProduct } from "./fixtures";

const categories = new Map([["wall-hangings", "c1"], ["home-decor", "c2"]]);
const HEADER = PRODUCT_CSV_COLUMNS.join(",");
const importCsv = (body: string) => parseProductCsv(`${HEADER}\n${body}`, { categoryIdBySlug: categories });

describe("parseCsv / toCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF and BOM", () => {
    const text = '﻿a,b\r\n"x, y","he said ""hi"""\r\n"line1\nline2",z\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["line1\nline2", "z"],
    ]);
  });

  it("keeps a quote inside an unquoted field and drops blank lines", () => {
    expect(parseCsv('5" rug,x\n\n\nlast,y')).toEqual([["5\" rug", "x"], ["last", "y"]]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"b')).toThrow("unterminated_quote");
  });

  it("round-trips awkward cells", () => {
    const rows = [["نام", 'x "y"', "a,b", "line\nbreak", " padded "]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("formula injection protection", () => {
  it.each(["=1+1", "+cmd", "-2", "@SUM(A1)", "\tTab"])("protects %j and restores it", (value) => {
    const protectedValue = protectCell(value);
    expect(protectedValue.startsWith("'")).toBe(true);
    expect(unprotectCell(protectedValue)).toBe(value);
  });
  it("leaves normal text alone", () => {
    expect(protectCell("ماکرومه")).toBe("ماکرومه");
    expect(unprotectCell("'quoted")).toBe("'quoted");
  });
});

describe("parseProductCsv", () => {
  it("imports a simple product, with Persian digits in numbers", () => {
    const r = importCsv("demo-a,دیوارکوب نمونه,توضیح,wall-hangings,published,unique,۱٬۲۰۰٬۰۰۰,۱,,images/p1/a.webp|images/p1/b.png,تصویر یک|تصویر دو,,,,");
    expect(r.issues).toEqual([]);
    expect(r.products).toHaveLength(1);
    const p = r.products[0]!;
    expect(p).toMatchObject({ slug: "demo-a", categoryId: "c1", priceToman: 1200000, inventory: 1, status: "published" });
    expect(p.images).toEqual([
      { key: "images/p1/a.webp", alt: "تصویر یک" },
      { key: "images/p1/b.png", alt: "تصویر دو" },
    ]);
  });

  it("groups rows with the same slug into variants", () => {
    const r = importCsv(
      [
        "cushion,کوسن نمونه,,home-decor,draft,stocked,500,,,,,S1,size=S|color=سبز,,4",
        "cushion,,,,,,,,,,,L1,size=L|color=سبز,600,0",
      ].join("\n"),
    );
    expect(r.issues).toEqual([]);
    expect(r.products).toHaveLength(1);
    expect(r.products[0]!.variants).toEqual([
      { sku: "S1", options: { size: "S", color: "سبز" }, priceToman: null, inventory: 4 },
      { sku: "L1", options: { size: "L", color: "سبز" }, priceToman: 600, inventory: 0 },
    ]);
  });

  it("reports row-numbered issues instead of throwing", () => {
    const r = importCsv(
      [
        "ok,نمونه یک,,,draft,unique,,,,,,,,,",
        "bad-cat,نمونه دو,,nope,draft,unique,,,,,,,,,",
        "bad-num,نمونه سه,,,draft,stocked,12.5,3,,,,,,,",
        "bad-rule,نمونه چهار,,,draft,made_to_order,,,,,,,,,",
        ",no slug,,,draft,unique,,,,,,,,,",
      ].join("\n"),
    );
    expect(r.products.map((p) => p.slug)).toEqual(["ok"]);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        { row: 3, field: "category_slug", code: "unknown_category" },
        { row: 4, field: "price_toman", code: "invalid_number" },
        { row: 5, field: "leadTimeDays", code: "lead_time_required" },
        { row: 6, field: "slug", code: "slug_required" },
      ]),
    );
  });

  it("flags conflicting product fields across rows of one product", () => {
    const r = importCsv(["x,نام یک,,,draft,stocked,,5,,,,A,size=S,,1", "x,نام دو,,,,,,,,,,B,size=L,,1"].join("\n"));
    expect(r.issues).toContainEqual({ row: 3, field: "name", code: "conflicting_product_fields" });
  });

  it("rejects bad headers and oversized input", () => {
    expect(parseProductCsv("slug,name\nx,y", { categoryIdBySlug: categories }).issues).toContainEqual({
      row: 1,
      field: "fulfillment",
      code: "missing_column",
    });
    expect(parseProductCsv(`${HEADER},surprise\n`, { categoryIdBySlug: categories }).issues).toContainEqual({
      row: 1,
      field: "surprise",
      code: "unknown_column",
    });
    expect(parseProductCsv("a".repeat(MAX_CSV_CHARS + 1), { categoryIdBySlug: categories }).issues[0]?.code).toBe(
      "csv_too_large",
    );
    expect(parseProductCsv('a,"b', { categoryIdBySlug: categories }).issues[0]?.code).toBe("csv_unterminated_quote");
    expect(parseProductCsv("", { categoryIdBySlug: categories }).issues[0]?.code).toBe("csv_empty");
  });

  it("removes injection protection on import", () => {
    const r = importCsv("x,'=HYPERLINK(1),,,draft,unique,,,,,,,,,");
    expect(r.products[0]?.name).toBe("=HYPERLINK(1)");
  });
});

describe("large prices in CSV", () => {
  const row = (price: string, variantPrice = "") =>
    `big,محصول گران,,wall-hangings,draft,stocked,"${price}",${variantPrice ? "" : "2"},,,,${variantPrice ? "V1" : ""},${variantPrice ? "size=L" : ""},${variantPrice},${variantPrice ? "1" : ""}`;

  it.each([
    ["5000000000000", 5_000_000_000_000],
    ["۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹", 999_999_999_999_999],
    ["1,000,000,000,000,000", 1_000_000_000_000_000],
    ["۵۰۰۰۰۰۰۰۰۰۰۰۰ تومان", 5_000_000_000_000],
  ])("imports %s exactly", (text, expected) => {
    const r = importCsv(row(text));
    expect(r.issues).toEqual([]);
    expect(r.products[0]?.priceToman).toBe(expected);
  });

  it("imports large variant prices exactly", () => {
    const r = importCsv(row("", "999999999999999"));
    expect(r.issues).toEqual([]);
    expect(r.products[0]?.variants[0]?.priceToman).toBe(999_999_999_999_999);
  });

  it("rejects amounts that are too big or would silently lose precision, with a row-numbered issue", () => {
    for (const text of ["1000000000000001", "9007199254740993", "99999999999999999999", "1e15", "12.5"]) {
      const r = importCsv(row(text));
      expect(r.products, text).toEqual([]);
      expect(r.issues[0], text).toMatchObject({ row: 2, field: expect.stringMatching(/price/i) });
    }
  });

  it("round-trips large prices through export and import", () => {
    const products = [storedProduct({ slug: "big", priceToman: 999_999_999_999_999 }), storedProduct({ id: "p2", slug: "bigger", priceToman: 1_000_000_000_000_000 })];
    const csv = toCsv(productsToCsvRows(products, new Map([["c1", "wall-hangings"]])));
    expect(csv).toContain("999999999999999");
    const r = parseProductCsv(csv, { categoryIdBySlug: categories });
    expect(r.issues).toEqual([]);
    expect(r.products.map((p) => p.priceToman)).toEqual([999_999_999_999_999, 1_000_000_000_000_000]);
  });
});

describe("export -> import round trip", () => {
  it("preserves products, variants and images, and protects formulas on export", () => {
    const products = [
      storedProduct({ slug: "wall", name: "=SUM(1)", description: "a, \"b\"\nc" }),
      storedProduct({
        id: "p2",
        slug: "cushion",
        name: "کوسن نمونه",
        categoryId: "c2",
        status: "draft",
        fulfillment: "stocked",
        priceToman: 500,
        inventory: null,
        images: [],
        variants: [
          { id: "v1", sku: "S1", options: { size: "S", color: "سبز" }, priceToman: null, inventory: 4, position: 0 },
          { id: "v2", sku: "L1", options: { size: "L", color: "سبز" }, priceToman: 600, inventory: 0, position: 1 },
        ],
      }),
    ];
    const rows = productsToCsvRows(products, new Map([["c1", "wall-hangings"], ["c2", "home-decor"]]));
    expect(rows[1]![1]).toBe("'=SUM(1)");

    const csv = toCsv(rows);
    const r = parseProductCsv(csv, { categoryIdBySlug: categories });
    expect(r.issues).toEqual([]);
    expect(r.products).toHaveLength(2);
    expect(r.products[0]).toMatchObject({ slug: "wall", name: "=SUM(1)", description: "a, \"b\"\nc", priceToman: 1000 });
    expect(r.products[1]!.variants).toHaveLength(2);
    expect(r.products[1]).toMatchObject({ categoryId: "c2", status: "draft", fulfillment: "stocked" });
  });
});
