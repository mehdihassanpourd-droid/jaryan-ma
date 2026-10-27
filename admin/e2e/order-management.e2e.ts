import { expect as pw } from "playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import type { BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminCatalog } from "./admin-api";
import { startHarness, type Harness } from "./harness";
import { eventually, fillShipping, signInOnCheckout } from "./shop-helpers";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * Order management and inventory safety, end to end in real browsers at phone size, on real PostgreSQL when
 * E2E_DATABASE_URL is set: two shoppers fight for ONE unique piece (exactly one wins), the owner sees the order (indicator,
 * pending on top), confirms, cancels and rejects with reasons, stock comes back exactly once and the other shopper can then
 * buy it, customers see every status change and can cancel their own pending order. Every request any page makes must go to
 * the local servers: the store has no foreign runtime dependency (it must keep working when the international internet is cut).
 */
const ADMIN_PORT = 47833;
const A = { local: "09121234567", e164: "+989121234567", name: "علی رضایی" };
const B = { local: "09351234567", e164: "+989351234567", name: "مریم احمدی" };
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

let h: Harness;
let site: { dir: string; server: Server; url: string };
const hosts = new Set<string>();

beforeAll(async () => {
  const dir = buildStorefront({ NEXT_PUBLIC_CATALOG_URL: `http://127.0.0.1:${ADMIN_PORT}/media`, NEXT_PUBLIC_ORDER_API_URL: `http://127.0.0.1:${ADMIN_PORT}` });
  site = { dir, ...(await serveStatic(dir)) };
  h = await startHarness({ port: ADMIN_PORT, customerOrigins: site.url, ...(process.env.E2E_DATABASE_URL ? { databaseUrl: process.env.E2E_DATABASE_URL } : {}) });
}, 600_000);
afterEach((context) => {
  if (context.task.result?.state === "fail") console.error(`--- server log (tail) after "${context.task.name}":\n${h?.serverLog(80)}`);
});
afterAll(async () => {
  await h?.stop();
  site?.server.closeAllConnections();
  await new Promise((r) => (site ? site.server.close(r) : r(undefined)));
  if (site) rmSync(site.dir, { recursive: true, force: true });
});

const phone = async (opts: object = {}): Promise<BrowserContext> => {
  const ctx = await h.browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: "fa-IR", ...opts });
  ctx.on("request", (r) => {
    if (/^(https?|wss?):/.test(r.url())) hosts.add(new URL(r.url()).host);
  });
  return ctx;
};
const noSideScroll = async (page: Page, where: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal scroll on ${where}`).toBeLessThanOrEqual(0);
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(c: Document, o: object): Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}
const sql = (query: string): string | null => (process.env.E2E_DATABASE_URL ? execFileSync("psql", [process.env.E2E_DATABASE_URL, "-At", "-c", query], { encoding: "utf8" }).trim() : null);
const stockOf = (slug: string) => sql(`select inventory from products where slug = '${slug}'`);
const variantStock = (sku: string) => sql(`select inventory from product_variants where sku = '${sku}'`);
const orderStatus = (number: number) => sql(`select status from orders where number = ${number}`);
const shot = async (page: Page, name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }); };
const tall = async (locator: ReturnType<Page["locator"]>, what: string) => expect((await locator.boundingBox())?.height ?? 0, `${what}: touch target`).toBeGreaterThanOrEqual(44);

let adminCtx: BrowserContext;
let admin: Page;
let catalog: Awaited<ReturnType<typeof adminCatalog>>;
let rug: { id: string; slug: string };
let cushion: { id: string; slug: string };
let pageA: Page;
let pageB: Page;
let ctxA: BrowserContext;
let ctxB: BrowserContext;
let winner: "A" | "B";
let winnerOrder = 0;

describe("order management and inventory safety (phones, real PostgreSQL)", () => {
  it("setup: catalogue, and two signed-in shoppers with the same unique piece in their carts and the checkout form filled", async () => {
    // the owner's admin session; the clock is controlled so the 30-second "new orders" poll can be fast-forwarded
    adminCtx = await phone();
    await adminCtx.clock.install();
    admin = await h.login(adminCtx, h.accounts.owner);
    catalog = await adminCatalog(admin, h.baseUrl);
    const cat = await catalog.category("wall", "تابلو و بافته");
    await catalog.freeShipping();
    rug = await catalog.product({ name: "تابلو گلیم کوهستان", categoryId: cat, fulfillment: "unique", priceToman: 4_500_000, inventory: 1, slug: "kuhestan-rug", description: "بافته با دست" });
    cushion = await catalog.product({ name: "کوسن بافته", categoryId: cat, fulfillment: "stocked", priceToman: 500_000, slug: "woven-cushion", variants: [{ sku: "CU-S", options: { اندازه: "کوچک" }, priceToman: 500_000, inventory: 3 }] }, { tone: [90, 110, 70] });

    for (const who of [A, B]) {
      const ctx = await phone();
      const page = await ctx.newPage();
      await page.goto(`${site.url}/product?slug=${rug.slug}`);
      await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
      await page.goto(`${site.url}/checkout`);
      await signInOnCheckout(h, page, who.local, who.e164);
      await fillShipping(page, who.name, who.local);
      if (who === A) [ctxA, pageA] = [ctx, page];
      else [ctxB, pageB] = [ctx, page];
    }
    expect(stockOf("kuhestan-rug")).toBe(process.env.E2E_DATABASE_URL ? "1" : null);
  });

  it("two shoppers tap 'place order' for the ONE piece at the same moment: exactly one gets it", async () => {
    await Promise.all([pageA.getByTestId("place-order").tap(), pageB.getByTestId("place-order").tap()]);
    // Polling, not a race of waiters: the loser's "wait for the order page" must not be left hanging until it times out.
    const outcome = async (page: Page): Promise<"won" | "lost"> => {
      for (let i = 0; i < 120; i++) {
        if (/\/order\?number=\d+/.test(page.url())) return "won";
        if ((await page.getByTestId("checkout-failure").count()) > 0) return "lost";
        await page.waitForTimeout(250);
      }
      throw new Error("neither a confirmation nor a refusal appeared");
    };
    const [a, b] = await Promise.all([outcome(pageA), outcome(pageB)]);
    expect([a, b].sort()).toEqual(["lost", "won"]);
    winner = a === "won" ? "A" : "B";
    const [won, lost] = winner === "A" ? [pageA, pageB] : [pageB, pageA];

    await pw(won.getByTestId("order-status")).toHaveText("در انتظار تأیید");
    winnerOrder = Number(/number=(\d+)/.exec(won.url())?.[1]);
    await pw(lost.getByTestId("checkout-failure")).toContainText("سفارش ثبت نشد");
    await pw(lost.getByText("کالای قابل سفارشی در سبد شما نیست.")).toBeVisible({ timeout: 15_000 }); // the page re-read the catalogue: the piece is gone
    expect(sql("select count(*) from orders")).toBe(process.env.E2E_DATABASE_URL ? "1" : null);
    expect(stockOf("kuhestan-rug")).toBe(process.env.E2E_DATABASE_URL ? "0" : null);
    expect(sql("select sum(\"reservedQuantity\") from order_items")).toBe(process.env.E2E_DATABASE_URL ? "1" : null);
    await noSideScroll(won, "order confirmation");
  });

  it("the owner is told: indicator in the nav, banner, toast and title; pending orders on top of the list, highlighted", async () => {
    await admin.goto(`${h.baseUrl}/admin/#/products`);
    await admin.reload(); // a fresh page load asks at once; an open page learns within 30 seconds (next test)
    await pw(admin.getByTestId("orders-badge")).toHaveText("۱");
    await pw(admin.getByTestId("pending-banner")).toContainText("۱ سفارش در انتظار تأیید دارید");
    expect(await admin.title()).toMatch(/^\(۱\) /);
    await noSideScroll(admin, "admin banner");

    await admin.getByTestId("pending-banner").tap();
    await pw(admin.getByRole("heading", { name: "سفارش‌ها", level: 1 })).toBeVisible();
    const first = admin.getByRole("list", { name: "فهرست سفارش‌ها" }).getByRole("listitem").first();
    await pw(first).toHaveAttribute("data-status", "pending");
    await pw(first).toHaveClass(/row-attention/);
    await pw(first.getByRole("link", { name: "بررسی" })).toBeVisible();
    await shot(admin, "om-list");
  });

  it("a NEW order while the owner is looking at the app is announced without reloading (the 30-second poll)", async () => {
    // third shopper places an order for the cushion while the admin sits on the products page
    await admin.goto(`${h.baseUrl}/admin/#/products`);
    await admin.reload();
    await pw(admin.getByTestId("orders-badge")).toHaveText("۱");
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${site.url}/product?slug=${cushion.slug}`);
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
    await page.goto(`${site.url}/checkout`);
    await signInOnCheckout(h, page, "09371234567", "+989371234567");
    await fillShipping(page, "سارا کریمی", "09371234567");
    await page.getByTestId("place-order").tap();
    await page.waitForURL(/\/order\?number=\d+/);
    const cushionOrder = Number(/number=(\d+)/.exec(page.url())?.[1]);
    expect(variantStock("CU-S")).toBe(process.env.E2E_DATABASE_URL ? "2" : null);

    await admin.clock.fastForward(31_000);
    await pw(admin.getByTestId("orders-badge")).toHaveText("۲");
    await pw(admin.locator(".toast", { hasText: "سفارش جدیدی ثبت شد" }).first()).toBeVisible();
    expect(await admin.title()).toMatch(/^\(۲\) /);

    // this shopper changes their mind: cancels the pending order themselves (two steps), the cushion is free again
    await page.getByTestId("cancel-order").tap();
    await pw(page.getByRole("group", { name: "تأیید لغو سفارش" })).toBeVisible();
    await page.getByTestId("confirm-cancel").tap();
    await pw(page.getByTestId("order-status")).toHaveText("لغو شده");
    await pw(page.getByTestId("refusal-note")).toContainText("شما این سفارش را لغو کردید");
    await pw(page.getByTestId("cancel-order")).toHaveCount(0);
    await pw(page.getByTestId("order-history").getByRole("listitem")).toHaveCount(2);
    expect(variantStock("CU-S")).toBe(process.env.E2E_DATABASE_URL ? "3" : null);
    expect(orderStatus(cushionOrder)).toBe(process.env.E2E_DATABASE_URL ? "cancelled" : null);
    await admin.clock.fastForward(31_000);
    await pw(admin.getByTestId("orders-badge")).toHaveText("۱");
    await ctx.close();
  });

  it("the owner opens the order, sees what is reserved, confirms it; the customer's history shows it", async () => {
    await admin.goto(`${h.baseUrl}/admin/#/orders/${winnerOrder}`);
    await pw(admin.getByTestId("pending-notice")).toContainText("موجودی کالاهایش همین حالا برای او رزرو شده");
    await pw(admin.getByRole("main")).toContainText("۱ عدد رزرو شده");
    await pw(admin.getByRole("main")).toContainText(winner === "A" ? A.name : B.name);
    const actions = admin.getByTestId("order-actions");
    await pw(actions.getByRole("button")).toHaveText(["تأیید سفارش", "رد سفارش", "لغو سفارش"]);
    await tall(actions.getByRole("button", { name: "تأیید سفارش" }), "confirm");
    await noSideScroll(admin, "admin order detail");
    await shot(admin, "om-detail");
    expect(await axeViolations(admin)).toEqual([]);

    await actions.getByRole("button", { name: "تأیید سفارش" }).tap();
    await pw(admin.getByText("وضعیت سفارش: تأیید شده").first()).toBeVisible();
    await pw(admin.getByTestId("pending-notice")).toHaveCount(0);
    await pw(actions.getByRole("button")).toHaveText(["شروع آماده‌سازی", "لغو سفارش"]);
    await pw(admin.getByTestId("history").getByRole("listitem")).toHaveCount(2);
    await pw(admin.getByTestId("history")).toContainText(h.accounts.owner.email);
    expect(orderStatus(winnerOrder)).toBe(process.env.E2E_DATABASE_URL ? "confirmed" : null);

    // the winner sees it on their order page (re-read when they come back to the tab), and can no longer cancel it themselves
    const won = winner === "A" ? pageA : pageB;
    await won.goto(`${site.url}/orders`);
    await pw(won.getByTestId("orders-list")).toContainText("تأیید شده");
    await won.getByTestId("orders-list").getByRole("link").tap();
    await pw(won.getByTestId("order-status")).toHaveText("تأیید شده");
    await pw(won.getByText("گالری این سفارش را تأیید کرد.")).toBeVisible();
    await pw(won.getByTestId("cancel-order")).toHaveCount(0);
    await pw(won.getByTestId("order-history").getByRole("listitem")).toHaveCount(2);
    expect(await axeViolations(won)).toEqual([]);
  });

  it("the owner cancels the confirmed order with a reason: the piece returns exactly once and the other shopper can now buy it", async () => {
    await admin.goto(`${h.baseUrl}/admin/#/orders/${winnerOrder}`);
    await admin.getByTestId("order-actions").getByRole("button", { name: "لغو سفارش" }).tap();
    await pw(admin.getByTestId("reason-form")).toBeVisible();
    await shot(admin, "om-reason");
    await admin.getByLabel(/دلیل/).fill("اثر هنگام بسته‌بندی آسیب دید");
    await admin.getByTestId("reason-form").getByRole("button", { name: "لغو سفارش" }).tap();
    await pw(admin.getByText("وضعیت سفارش: لغو شده").first()).toBeVisible();
    await pw(admin.getByText("موجودی این سفارش به انبار برگردانده شد.")).toBeVisible();
    await pw(admin.getByRole("main")).not.toContainText("عدد رزرو شده");
    await pw(admin.getByTestId("history")).toContainText("دلیل: اثر هنگام بسته‌بندی آسیب دید");
    expect(stockOf("kuhestan-rug")).toBe(process.env.E2E_DATABASE_URL ? "1" : null);
    expect(orderStatus(winnerOrder)).toBe(process.env.E2E_DATABASE_URL ? "cancelled" : null);
    // double-clicking cancel again changes nothing (the button is gone; the order is final)
    await pw(admin.getByTestId("order-actions")).toHaveCount(0);

    // the winner sees the cancellation and why
    const won = winner === "A" ? pageA : pageB;
    await won.goto(`${site.url}/order?number=${winnerOrder}`);
    await pw(won.getByTestId("order-status")).toHaveText("لغو شده");
    await pw(won.getByTestId("refusal-note")).toContainText("اثر هنگام بسته‌بندی آسیب دید");
    await noSideScroll(won, "cancelled order");

    // the other shopper still has the piece in their cart: once the public catalogue refreshes they can order it
    const lost = winner === "A" ? pageB : pageA;
    const loser = winner === "A" ? B : A;
    await lost.goto(`${site.url}/checkout`);
    await eventually(lost, async () => {
      await pw(lost.getByTestId("place-order")).toBeVisible({ timeout: 1000 });
    }, "the returned piece to be orderable again");
    await pw(lost.getByTestId("checkout-total")).toHaveText("۴٬۵۰۰٬۰۰۰ تومان");
    if ((await lost.getByLabel(/نام و نام خانوادگی گیرنده/).inputValue()) === "") await fillShipping(lost, loser.name, loser.local);
    await lost.getByTestId("place-order").tap();
    await lost.waitForURL(/\/order\?number=\d+/);
    const second = Number(/number=(\d+)/.exec(lost.url())?.[1]);
    expect(second).not.toBe(winnerOrder);
    expect(stockOf("kuhestan-rug")).toBe(process.env.E2E_DATABASE_URL ? "0" : null);
    expect(sql(`select count(*) from orders where status in ('pending','confirmed')`)).toBe(process.env.E2E_DATABASE_URL ? "1" : null);
  });

  it("the owner rejects a pending order with a reason: stock returns, the customer sees 'rejected' and why; a stale screen cannot overwrite", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${site.url}/product?slug=${cushion.slug}`);
    await page.getByRole("button", { name: /افزودن تعداد/ }).tap();
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
    await page.goto(`${site.url}/checkout`);
    await signInOnCheckout(h, page, "09391234567", "+989391234567");
    await fillShipping(page, "رضا نوری", "09391234567");
    await page.getByTestId("place-order").tap();
    await page.waitForURL(/\/order\?number=\d+/);
    const n = Number(/number=(\d+)/.exec(page.url())?.[1]);
    expect(variantStock("CU-S")).toBe(process.env.E2E_DATABASE_URL ? "1" : null); // 3 − 2

    // two staff screens open on the same pending order; one rejects, the other (stale) tries to confirm
    const second = await adminCtx.newPage();
    await second.goto(`${h.baseUrl}/admin/#/orders/${n}`);
    await pw(second.getByTestId("order-actions")).toBeVisible();
    await admin.goto(`${h.baseUrl}/admin/#/orders/${n}`);
    await admin.getByTestId("order-actions").getByRole("button", { name: "رد سفارش" }).tap();
    await admin.getByLabel(/دلیل/).fill("موجودی نداریم");
    await admin.getByTestId("reason-form").getByRole("button", { name: "رد سفارش" }).tap();
    await pw(admin.getByText("وضعیت سفارش: رد شده").first()).toBeVisible();
    expect(variantStock("CU-S")).toBe(process.env.E2E_DATABASE_URL ? "3" : null);

    await second.getByTestId("order-actions").getByRole("button", { name: "تأیید سفارش" }).tap();
    await pw(second.locator(".toast", { hasText: "در همین فاصله تغییر کرده" }).first()).toBeVisible();
    await pw(second.getByText("رد شده").first()).toBeVisible(); // the screen reloaded the real state
    await pw(second.getByTestId("order-actions")).toHaveCount(0);
    expect(orderStatus(n)).toBe(process.env.E2E_DATABASE_URL ? "rejected" : null);
    await second.close();

    await page.goto(`${site.url}/order?number=${n}`);
    await pw(page.getByTestId("order-status")).toHaveText("رد شده");
    await pw(page.getByTestId("refusal-note")).toContainText("گالری این سفارش را نپذیرفت");
    await pw(page.getByTestId("refusal-note")).toContainText("موجودی نداریم");
    await pw(page.getByTestId("order-history")).toContainText("رد شده");
    expect(await axeViolations(page)).toEqual([]);
    await noSideScroll(page, "rejected order");
    await shot(page, "om-customer-rejected");
    await ctx.close();

    // the audit trail: who did what, with no phone numbers
    if (process.env.E2E_DATABASE_URL) {
      expect(sql(`select count(*) from audit_log where entity = 'order'`)).toBe("4"); // confirm, staff cancel, customer cancel, reject
      expect(sql(`select string_agg(action, ',' order by at) from audit_log where entity = 'order'`)).toContain("order.rejected");
      expect(sql(`select count(*) from audit_log where entity = 'order' and detail::text like '%+98%'`)).toBe("0");
    }
  });

  it("the list shows open orders first, the status filter works, and the badge counts only what waits", async () => {
    await admin.goto(`${h.baseUrl}/admin/#/orders`);
    const rows = admin.getByRole("list", { name: "فهرست سفارش‌ها" }).getByRole("listitem");
    await pw(rows.first()).toBeVisible();
    const statuses = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status));
    expect(statuses[0]).toBe("pending"); // the re-ordered rug order waits on top
    expect(statuses).toEqual([...statuses].sort((x, y) => ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled", "rejected"].indexOf(x as string) - ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled", "rejected"].indexOf(y as string)));
    await admin.getByLabel("وضعیت").selectOption("rejected");
    await pw(rows).toHaveCount(1);
    await admin.getByLabel("وضعیت").selectOption("cancelled");
    await pw(rows).toHaveCount(2);
    await pw(admin.getByTestId("orders-badge")).toHaveText("۱");
    await noSideScroll(admin, "admin list");
  });

  it("no page ever contacted a foreign host: the store has no foreign runtime dependency", async () => {
    await pageA.close();
    await pageB.close();
    await ctxA.close();
    await ctxB.close();
    await adminCtx.close();
    expect([...hosts].sort()).toEqual([...hosts].filter((host) => host.startsWith("127.0.0.1:")).sort());
    expect(hosts.size).toBeGreaterThan(1); // the check really looked at traffic (storefront + API)
  });
});
