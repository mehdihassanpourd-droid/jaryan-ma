import type { Page } from "playwright";
import { solidPng } from "./png";

type Json = Record<string, unknown>;

/**
 * The store owner's catalogue actions through the REAL admin API, using the signed-in admin page's own session
 * (cookie jar + CSRF token), exactly as the admin app does. Used to prepare and change the catalogue in tests whose
 * subject is something else (the customer's journey); the admin UI itself is covered by its own tests.
 */
export async function adminCatalog(admin: Page, baseUrl: string) {
  const session = (await (await admin.request.get(`${baseUrl}/api/v1/auth/session`)).json()) as { csrfToken: string };
  const headers = { "x-csrf-token": session.csrfToken, origin: baseUrl };
  const ok = async (label: string, response: Awaited<ReturnType<Page["request"]["post"]>>) => {
    if (!response.ok()) throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
    return (await response.json()) as Json;
  };

  return {
    async category(slug: string, name: string): Promise<string> {
      const r = await ok("category", await admin.request.post(`${baseUrl}/api/v1/categories`, { headers, data: { slug, name } }));
      return (r.category as { id: string }).id;
    },

    /** Creates a product as a draft, adds one real image, and publishes it unless `status` says otherwise. */
    async product(input: Json, options: { status?: "draft" | "published"; tone?: [number, number, number] } = {}): Promise<{ id: string; slug: string }> {
      const created = await ok("create", await admin.request.post(`${baseUrl}/api/v1/products`, { headers, data: { status: "draft", description: "", images: [], variants: [], ...input } }));
      const product = created.product as { id: string; slug: string; version: number };
      await ok("image", await admin.request.post(`${baseUrl}/api/v1/products/${product.id}/images?alt=${encodeURIComponent("تصویر محصول")}`, { headers: { ...headers, "content-type": "image/png" }, data: solidPng(60, 80, options.tone ?? [176, 132, 92]) }));
      if ((options.status ?? "published") === "published") {
        const current = (await (await admin.request.get(`${baseUrl}/api/v1/products/${product.id}`)).json()) as { product: { version: number } };
        await ok("publish", await admin.request.post(`${baseUrl}/api/v1/products/${product.id}/status`, { headers, data: { status: "published", expectedVersion: current.product.version } }));
      }
      return { id: product.id, slug: product.slug };
    },

    /** Changes stock (a product's, or one variant's) the way the editor would: read, modify, PUT with the version. */
    async setStock(id: string, inventory: number, sku?: string): Promise<void> {
      const { product } = (await (await admin.request.get(`${baseUrl}/api/v1/products/${id}`)).json()) as { product: Json & { version: number; images: Array<{ key: string; alt: string }>; variants: Array<Json & { sku: string }> } };
      const body = {
        slug: product.slug, name: product.name, description: product.description, categoryId: product.categoryId, status: product.status, fulfillment: product.fulfillment,
        priceToman: product.priceToman, inventory: sku ? product.inventory : inventory, leadTimeDays: product.leadTimeDays,
        images: product.images.map((i) => ({ key: i.key, alt: i.alt })),
        variants: product.variants.map((v) => ({ sku: v.sku, options: v.options, priceToman: v.priceToman, inventory: v.sku === sku ? inventory : v.inventory })),
        seoTitle: product.seoTitle, seoDescription: product.seoDescription,
      };
      await ok("stock", await admin.request.put(`${baseUrl}/api/v1/products/${id}`, { headers, data: { expectedVersion: product.version, product: body } }));
    },
  };
}
