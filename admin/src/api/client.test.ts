import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setCsrfToken, setUnauthorizedHandler } from "./client";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken("");
  setUnauthorizedHandler(() => undefined);
});

describe("api client", () => {
  it("sends the CSRF token only on mutations, same-origin, uncached", async () => {
    const fetchMock = vi.fn(async () => reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    setCsrfToken("tok");
    await api("GET", "/products", { query: { q: "الف", page: 2, empty: "" } });
    await api("POST", "/products", { body: { a: 1 } });
    const [getUrl, getInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, postInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(getUrl).toBe("/api/v1/products?q=%D8%A7%D9%84%D9%81&page=2");
    expect((getInit.headers as Record<string, string>)["x-csrf-token"]).toBeUndefined();
    expect((postInit.headers as Record<string, string>)["x-csrf-token"]).toBe("tok");
    expect(getInit).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });

  it("turns error bodies into ApiError with issues and Retry-After", async () => {
    vi.stubGlobal("fetch", async () => reply(429, { error: "too_many_attempts" }, { "retry-after": "120" }));
    await expect(api("POST", "/auth/login", { anonymous: true })).rejects.toMatchObject({ status: 429, code: "too_many_attempts", retryAfterSeconds: 120 });
    vi.stubGlobal("fetch", async () => reply(422, { error: "validation_failed", issues: [{ path: "name", code: "invalid_too_small" }] }));
    const error = await api("POST", "/products", { body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).issues).toEqual([{ path: "name", code: "invalid_too_small" }]);
  });

  it("401 signals session expiry except for the login/session probes", async () => {
    const expired = vi.fn();
    setUnauthorizedHandler(expired);
    vi.stubGlobal("fetch", async () => reply(401, { error: "unauthorized" }));
    await api("GET", "/products").catch(() => undefined);
    expect(expired).toHaveBeenCalledTimes(1);
    await api("GET", "/auth/session", { anonymous: true }).catch(() => undefined);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("maps a network failure to network_error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("failed");
    });
    await expect(api("GET", "/products")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("uploads raw bytes with the given content type", async () => {
    const fetchMock = vi.fn(async () => reply(201, { key: "k" }));
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
    await api("POST", "/products/p/images", { raw: blob, contentType: "image/webp" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(blob);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("image/webp");
  });
});
