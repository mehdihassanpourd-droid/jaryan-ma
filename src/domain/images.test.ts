import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, buildImageKey, sniffImageType, validateImageUpload } from "./images";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = Uint8Array.from([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 ")]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("sniffImageType", () => {
  it("detects JPEG, PNG and WebP by content", () => {
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(webp)).toBe("image/webp");
  });
  it("rejects everything else, including SVG and HTML", () => {
    expect(sniffImageType(svg)).toBeNull();
    expect(sniffImageType(Buffer.from("<html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("validateImageUpload", () => {
  it("accepts a matching declared type", () => {
    expect(validateImageUpload(webp, "image/webp")).toEqual({ ok: true, type: "image/webp", extension: "webp" });
    expect(validateImageUpload(jpeg, "image/jpeg; charset=binary")).toMatchObject({ ok: true, extension: "jpg" });
  });
  it("rejects empty, oversized, spoofed and unsupported uploads", () => {
    expect(validateImageUpload(new Uint8Array(), "image/png")).toEqual({ ok: false, code: "empty" });
    expect(validateImageUpload(png, "image/jpeg")).toEqual({ ok: false, code: "type_mismatch" });
    expect(validateImageUpload(svg, "image/png")).toEqual({ ok: false, code: "unsupported_type" });
    expect(validateImageUpload(new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff), "image/jpeg")).toEqual({ ok: false, code: "too_large" });
  });
});

describe("buildImageKey", () => {
  it("builds a namespaced key and refuses path tricks", () => {
    expect(buildImageKey("abc-1", "def-2", "webp")).toBe("images/abc-1/def-2.webp");
    expect(() => buildImageKey("../x", "def", "webp")).toThrow();
    expect(() => buildImageKey("abc", "a/b", "webp")).toThrow();
  });
});
