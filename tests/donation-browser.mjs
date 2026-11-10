import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.DONATION_TEST_URL ?? "http://127.0.0.1:5191";
const output = process.env.DONATION_SCREENSHOTS ?? "/tmp/lokalchat-donation";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1080 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Provider URLs must never be contacted while payments are unavailable.
  const payments = [];
  page.on("request", (request) => {
    if (/https:\/\/[^/]*(stripe|toyyibpay)/i.test(request.url()))
      payments.push(request.url());
  });
  await page.goto(`${base}/donate`);
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("heading", { name: "Support LokalChat", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("radio", { name: "RM 10", exact: true }).isChecked(),
    true,
  );
  await page.getByRole("radio", { name: "RM 25", exact: true }).check();
  assert.match(
    await page.locator(".lc-donation-summary").innerText(),
    /RM 25.00/,
  );
  await page.getByRole("radio", { name: "Jumlah lain", exact: true }).check();
  const amount = page.getByLabel("Jumlah dalam Ringgit Malaysia (RM)", {
    exact: true,
  });
  await amount.fill("12.50");
  assert.match(
    await page.locator(".lc-donation-summary").innerText(),
    /RM 12.50/,
  );
  for (const value of ["0", "-1", "10001", "1.234", ""]) {
    await amount.fill(value);
    assert.equal(await amount.getAttribute("aria-invalid"), "true");
    assert.match(await page.locator(".lc-donation-summary").innerText(), /—/);
  }
  await page.getByRole("radio", { name: "RM 10", exact: true }).check();
  await page.getByRole("radio", { name: /Stripe/ }).check();
  assert.equal(
    await page
      .getByRole("button", { name: "Bayaran belum tersedia" })
      .isDisabled(),
    true,
  );
  assert.match(
    await page
      .getByRole("link", { name: "Kembali ke tetapan" })
      .getAttribute("href"),
    /\/dashboard\/settings#about$/,
  );
  await page.screenshot({
    path: `${output}/donation-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("switch", { name: "Tema gelap" }).click();
  assert.equal(
    await page.locator("html").evaluate((el) => el.classList.contains("dark")),
    true,
  );
  await page.screenshot({
    path: `${output}/donation-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: `${output}/donation-mobile.png`,
    fullPage: true,
  });
  await page.evaluate(() =>
    localStorage.setItem(
      "lokalchat-preferences",
      JSON.stringify({
        language: "en",
        timeZone: "Asia/Kuala_Lumpur",
        dateFormat: "dd/MM/yyyy",
      }),
    ),
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Choose your gift" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Payments not available yet" })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole("switch", { name: "Dark theme" }).count(),
    1,
  );
  // A fresh visitor can load the public route without an authenticated session.
  assert.equal(new URL(page.url()).pathname, "/donate");
  assert.deepEqual(payments, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: public route, preset/custom amounts and invalid values, provider choices, payment disabled, return link, light/dark, mobile overflow, BM/English, no payment requests or browser errors.",
  );
} finally {
  await browser.close();
}
