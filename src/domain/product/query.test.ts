import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, MAX_SEARCH_TERMS, parseProductListQuery, searchTerms, type ProductListQuery } from "./query";

function parse(qs: string): ProductListQuery {
  const r = parseProductListQuery(new URLSearchParams(qs));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

describe("parseProductListQuery", () => {
  it("applies defaults", () => {
    expect(parse("")).toMatchObject({ sort: "updated_desc", page: 1, pageSize: 20 });
  });

  it("parses filters", () => {
    const q = parse("status=draft,published&fulfillment=made_to_order&minPrice=100&maxPrice=500&page=3&pageSize=50");
    expect(q).toMatchObject({ status: ["draft", "published"], fulfillment: "made_to_order", minPrice: 100, maxPrice: 500, page: 3, pageSize: 50 });
  });

  it.each(["pageSize=1000", "page=0", "sort=name;DROP TABLE products", "status=hacked", "minPrice=-1", "maxPrice=3000000000", "fulfillment=x", "availability=maybe"])(
    "rejects %s",
    (qs) => {
      expect(parseProductListQuery(new URLSearchParams(qs)).ok).toBe(false);
    },
  );

  it("caps the page size", () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });
});

describe("searchTerms", () => {
  it("normalises Persian text, digits and Arabic letters", () => {
    expect(searchTerms("۵۰ كيف")).toEqual(["50", "کیف"]);
    expect(searchTerms("  ")).toEqual([]);
    expect(searchTerms(undefined)).toEqual([]);
  });

  it("drops LIKE wildcards and backslashes so they cannot match everything", () => {
    expect(searchTerms("100%")).toEqual(["100"]);
    expect(searchTerms("%")).toEqual([]);
    expect(searchTerms("_ a_b \\")).toEqual(["ab"]);
  });

  it("limits the number of terms", () => {
    expect(searchTerms("a b c d e f g h")).toHaveLength(MAX_SEARCH_TERMS);
  });
});
