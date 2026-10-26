import { describe, expect, it } from "vitest";
import { fitWithin, isSafeImageKey, mediaUrl } from "./images";

describe("image helpers", () => {
  it("scales the long side down to the limit and never enlarges", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1, 100000).height).toBe(2000);
    expect(fitWithin(1, 100000).width).toBeGreaterThanOrEqual(1);
  });
  it("only builds URLs for keys shaped like server-issued ones", () => {
    expect(isSafeImageKey("images/abc-1/def-2.webp")).toBe(true);
    for (const bad of ["../images/a/b.png", "images/a/b.svg", "images/a/b.png?x=1", "https://evil.example/x.png", "images/a/b/c.png", "javascript:alert(1)"]) {
      expect(isSafeImageKey(bad), bad).toBe(false);
    }
  });
  it("joins media base and key without doubling slashes", () => {
    expect(mediaUrl("https://m.example/", "images/a/b.png")).toBe("https://m.example/images/a/b.png");
  });
});
