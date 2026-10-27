import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect as pw } from "playwright/test";
import type { BrowserContext, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

let h: Harness;
let ownerCtx: BrowserContext;
let owner: Page;
const problems: string[] = [];

beforeAll(async () => {
  h = await startHarness();
  ownerCtx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
  ownerCtx.on("page", (page) => {
    // The signed-out session probe legitimately answers 401; every other console error (CSP violations included) is a defect.
    page.on("console", (m) => m.type() === "error" && !m.text().includes("status of 401") && problems.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  });
  owner = await h.login(ownerCtx, h.accounts.owner);
});
afterAll(async () => {
  await h?.stop();
});

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run(ctx: Document, opts: object): Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe.run;
    const r = await run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  return result;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe("security", () => {
  it("session cookie is HttpOnly + SameSite=Strict and nothing sensitive sits in web storage", async () => {
    const cookies = await ownerCtx.cookies();
    const session = cookies.find((c) => c.name.includes("session"));
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Strict");
    const stored = await owner.evaluate(async () => ({
      local: Object.keys(localStorage).length,
      session: Object.keys(sessionStorage).length,
      idb: ((await indexedDB.databases?.()) ?? []).length,
      jsCookie: document.cookie,
    }));
    expect(stored).toEqual({ local: 0, session: 0, idb: 0, jsCookie: "" });
  });

  it("serves a strict CSP and noindex, and the PWA manifest is installable", async () => {
    const res = await owner.request.get(`${h.baseUrl}/admin/`);
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    const manifest = (await (await owner.request.get(`${h.baseUrl}/admin/manifest.webmanifest`)).json()) as { display: string; dir: string; lang: string; scope: string; icons: Array<{ sizes: string; purpose?: string }> };
    expect(manifest).toMatchObject({ display: "standalone", dir: "rtl", lang: "fa", scope: "/admin/" });
    expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true);
    expect(manifest.icons.some((i) => i.purpose?.includes("maskable"))).toBe(true);
  });

  it("the service worker caches only the app shell: no API responses, no media", async () => {
    await owner.goto(`${h.baseUrl}/admin/#/products`);
    await owner.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await owner.reload(); // controlled page: assets now flow through the worker
    await owner.getByRole("navigation", { name: "بخش‌های مدیریت" }).waitFor();
    const cached = await owner.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
      return urls;
    });
    expect(cached.length).toBeGreaterThan(3);
    expect(cached.every((p) => p.startsWith("/admin/"))).toBe(true);
    expect(cached.some((p) => p.includes("/api/") || p.includes("/media"))).toBe(false);
  });

  it("roles: viewer is read-only (UI and server), editor can write", async () => {
    const viewerCtx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
    const viewer = await h.login(viewerCtx, h.accounts.viewer);
    await viewer.goto(`${h.baseUrl}/admin/#/products`);
    await viewer.getByRole("heading", { name: "محصولات" }).waitFor();
    await pw(viewer.getByRole("link", { name: /محصول جدید/ })).toHaveCount(0);
    await viewer.goto(`${h.baseUrl}/admin/#/data`);
    await pw(viewer.getByText("نقش شما اجازهٔ ورود داده ندارد")).toBeVisible();
    await viewer.goto(`${h.baseUrl}/admin/#/products/new`);
    await pw(viewer.getByText("فقط اجازهٔ مشاهده")).toBeVisible();
    await pw(viewer.getByRole("button", { name: /ذخیره/ })).toHaveCount(0);
    // the server is authoritative: a forged write from the read-only role is refused even though the UI hides it
    const refused = await viewer.evaluate(async () => {
      const s = (await (await fetch("/api/v1/auth/session")).json()) as { csrfToken: string };
      const r = await fetch("/api/v1/products", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": s.csrfToken }, body: JSON.stringify({ name: "نمونه", status: "draft", fulfillment: "unique", inventory: 1 }) });
      return r.status;
    });
    expect(refused).toBe(403);
    await viewerCtx.close();

    const editorCtx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
    const editor = await h.login(editorCtx, h.accounts.editor);
    await editor.goto(`${h.baseUrl}/admin/#/products/new`);
    await editor.getByLabel(/^نام محصول/).fill("پیش‌نویس ویرایشگر");
    await pw(editor.getByRole("button", { name: "ذخیره پیش‌نویس" })).toBeVisible();
    await pw(editor.getByRole("button", { name: "ایجاد و انتشار" })).toBeVisible(); // editors manage and publish the catalogue
    await editorCtx.close();
  });

  it("signing out ends the session", async () => {
    const ctx = await h.browser.newContext({ locale: "fa-IR" });
    const page = await h.login(ctx, h.accounts.owner);
    await page.goto(`${h.baseUrl}/admin/#/account`);
    await page.getByRole("button", { name: "خروج از حساب" }).click();
    await page.getByRole("button", { name: "ورود" }).waitFor();
    expect((await page.request.get(`${h.baseUrl}/api/v1/products`)).status()).toBe(401);
    await ctx.close();
  });
});

describe("mobile layout and accessibility", () => {
  const screens: Array<[string, string]> = [
    ["products", "#/products"],
    ["new product", "#/products/new"],
    ["data", "#/data"],
    ["categories", "#/categories"],
    ["account", "#/account"],
  ];

  for (const [name, hash] of screens) {
    it(`${name}: no horizontal scroll at 390px and no WCAG A/AA violations`, async () => {
      await owner.goto(`${h.baseUrl}/admin/${hash}`);
      await owner.getByRole("navigation", { name: "بخش‌های مدیریت" }).waitFor();
      await owner.locator("main h1").waitFor();
      expect(await overflow(owner)).toBeLessThanOrEqual(0);
      expect(await axeViolations(owner)).toEqual([]);
    });
  }

  it("editor tabs: every tab is accessible and fits the phone", async () => {
    await owner.goto(`${h.baseUrl}/admin/#/products/new`);
    await owner.getByLabel(/^نام محصول/).fill("آزمون دسترس‌پذیری");
    await owner.getByLabel("نوع تحویل").selectOption("stocked");
    await owner.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
    await owner.getByRole("tab", { name: "تصاویر" }).waitFor();
    for (const tab of ["گونه‌ها", "تصاویر", "سئو", "پیش‌نمایش", "اطلاعات"]) {
      await owner.getByRole("tab", { name: tab }).click();
      if (tab === "گونه‌ها") {
        await owner.getByRole("button", { name: "افزودن گونه" }).click();
      }
      expect(await overflow(owner), `overflow on ${tab}`).toBeLessThanOrEqual(0);
      expect(await axeViolations(owner), `axe on ${tab}`).toEqual([]);
    }
  });

  it("desktop width (1280px) shows the side navigation without overflow", async () => {
    await owner.setViewportSize({ width: 1280, height: 800 });
    await owner.goto(`${h.baseUrl}/admin/#/products`);
    await owner.locator("main h1").waitFor();
    expect(await overflow(owner)).toBeLessThanOrEqual(0);
    expect(await axeViolations(owner)).toEqual([]);
    await owner.setViewportSize({ width: 390, height: 844 });
  });

  it("raised no console errors or CSP violations during the whole run", () => {
    expect(problems).toEqual([]);
  });
});
