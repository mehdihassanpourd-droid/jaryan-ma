import { expect as pw } from "playwright/test";
import type { Page } from "playwright";
import type { Harness } from "./harness";

/** The most recent SMS code the (development) console provider printed for this number. */
export async function smsCode(h: Harness, e164: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const matches = [...h.serverLog(600).matchAll(new RegExp(`\\[dev sms\\] to ${e164.replace("+", "\\+")}: [^\\n]*?(\\d{6})`, "g"))];
    const last = matches.at(-1);
    if (last?.[1]) return last[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no SMS code in the server log");
}

/** On the checkout page of a signed-out shopper: request a code, enter it, accept the terms (a new number). */
export async function signInOnCheckout(h: Harness, page: Page, local: string, e164: string): Promise<void> {
  await page.getByLabel(/شمارهٔ موبایل/).fill(local);
  await page.getByRole("button", { name: "دریافت کد" }).tap();
  await page.getByLabel(/کد تأیید/).fill(await smsCode(h, e164));
  await page.getByRole("button", { name: "تأیید و ورود" }).tap();
  await page.getByRole("checkbox", { name: /شرایط استفاده/ }).check();
  await page.getByRole("button", { name: "تأیید و ورود" }).tap();
  await pw(page.getByTestId("shipping-form")).toBeVisible();
}

/** Picks a delivery method once the server has priced it (the options appear after the address is typed). */
export async function chooseDelivery(page: Page, method = "post"): Promise<void> {
  const radio = page.getByTestId(`delivery-${method}`);
  await pw(radio).toBeEnabled({ timeout: 15_000 });
  await radio.check();
  await pw(page.getByTestId("checkout-grand-total")).not.toHaveText("—");
}

export async function fillShipping(page: Page, name: string, phone: string, method = "post"): Promise<void> {
  await page.getByLabel(/نام و نام خانوادگی گیرنده/).fill(name);
  await page.getByLabel(/شمارهٔ موبایل گیرنده/).fill(phone);
  await page.getByRole("combobox", { name: /^استان/ }).selectOption("تهران");
  await page.getByLabel(/^شهر/).fill("تهران");
  await page.getByLabel(/نشانی کامل/).fill("خیابان ولیعصر، کوچه گل");
  await page.getByLabel(/کد پستی/).fill("1459813176");
  await chooseDelivery(page, method);
}

/** Reloads `page` until `check` passes: snapshots are written in the background and cached briefly. */
export async function eventually(page: Page, check: () => Promise<void>, what: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await page.waitForTimeout(500);
      await page.reload();
    }
  }
  throw new Error(`never saw: ${what}\n${String(last)}`);
}
