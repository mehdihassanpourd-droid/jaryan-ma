import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, buildProductListSql, parseProductListQuery, type ProductListQuery } from "./query";

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

  it.each(["pageSize=1000", "page=0", "sort=name;DROP TABLE products", "status=hacked", "minPrice=-1", "fulfillment=x", "availability=maybe"])(
    "rejects %s",
    (qs) => {
      expect(parseProductListQuery(new URLSearchParams(qs)).ok).toBe(false);
    },
  );

  it("caps the page size", () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });
});

describe("buildProductListSql", () => {
  it("excludes archived products by default", () => {
    const { list } = buildProductListSql(parse(""));
    expect(list.sql).toContain("p.status IN (?,?)");
    expect(list.params.slice(0, 2)).toEqual(["draft", "published"]);
  });

  it("binds every user value and never interpolates it", () => {
    const evil = "x'; DROP TABLE products; --";
    const { list, count } = buildProductListSql(parse(`q=${encodeURIComponent(evil)}&categoryId=${encodeURIComponent(evil)}`));
    expect(list.sql).not.toContain("DROP");
    expect(count.sql).not.toContain("DROP");
    expect(list.params.some((p) => String(p).includes("DROP"))).toBe(true);
    const placeholders = (list.sql.match(/\?/g) ?? []).length;
    expect(placeholders).toBe(list.params.length);
    expect(list.params.length).toBeLessThan(100);
  });

  it("escapes LIKE wildcards and normalises Persian search text", () => {
    const { list } = buildProductListSql(parse(`q=${encodeURIComponent("۵۰%_ كيف")}`));
    expect(list.params).toContain("%50\\%\\_%");
    expect(list.params).toContain("%کیف%");
    expect(list.sql).toContain("ESCAPE");
  });

  it("limits search terms", () => {
    const { list } = buildProductListSql(parse("q=a b c d e f g h"));
    expect(list.sql.match(/search_text LIKE/g)).toHaveLength(5);
  });

  it("only uses whitelisted sort fragments and computes the offset", () => {
    const { list } = buildProductListSql(parse("sort=price_asc&page=3&pageSize=10"));
    expect(list.sql).toContain("ORDER BY p.price_toman ASC");
    expect(list.params.slice(-2)).toEqual([10, 20]);
  });

  it("forceStatus overrides a client-supplied status filter", () => {
    const { list } = buildProductListSql(parse("status=draft,archived"), ["published"]);
    expect(list.params[0]).toBe("published");
    expect(list.params).not.toContain("draft");
  });
});
