import { describe, expect, it } from "vitest";
import { hrefFor, isProductId, parseHash } from "./router";

describe("hash router", () => {
  it("parses path and query", () => {
    const r = parseHash("#/products?q=%D9%BE&page=2");
    expect(r.path).toBe("/products");
    expect(r.params.get("q")).toBe("پ");
    expect(r.params.get("page")).toBe("2");
  });
  it("defaults to a rooted path", () => {
    expect(parseHash("").path).toBe("/");
    expect(parseHash("#products").path).toBe("/products");
  });
  it("builds hrefs and drops empty params", () => {
    expect(hrefFor("/products", { q: "", status: "draft", page: 1, x: undefined })).toBe("#/products?status=draft&page=1");
    expect(hrefFor("/data")).toBe("#/data");
  });
  it("only lets API-shaped ids reach request paths", () => {
    expect(isProductId("cm0abc-123")).toBe(true);
    for (const bad of ["", "..", "../auth/session", "a/b", "a?b=1", "a%2Fb", "x".repeat(65)]) expect(isProductId(bad), bad).toBe(false);
  });
});
