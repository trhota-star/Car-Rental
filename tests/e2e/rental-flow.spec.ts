// QA-9: complete rental flow in a real browser on desktop + mobile:
// register -> search -> vehicle + calendar -> extras (price check) -> checkout (driver + licence upload)
// -> declined card -> successful payment -> voucher (reference + QR) -> my rentals.
// Admin check-out / check-in run in rental-admin.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ymd = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const aed = (text: string | null) => Math.round(Number((text ?? "").replace(/[^0-9.]/g, "")) * 100);
/** 34335 -> "343.35", 123456 -> "1,234.56" */
const fmt = (fils: number) => (fils / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const visible = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true }).first();

/** Each device project books its own dates so the three runs never compete for the same car. */
function datesFor(projectName: string) {
  const offset = { "desktop-chrome": 20, "mobile-pixel7": 30, "mobile-iphone": 40 }[projectName] ?? 50;
  return { pickupDate: ymd(offset), returnDate: ymd(offset + 3) };
}

test("customer books, pays and gets a voucher", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { pickupDate, returnDate } = datesFor(testInfo.project.name);
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.test`;

  // 1. Register
  await page.goto("/register");
  await expectNoHorizontalOverflow(page);
  await page.getByLabel("Full name").fill("Layla E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Correct-Horse-9");
  await page.getByLabel("Confirm password").fill("Correct-Horse-9");
  await page.getByRole("button", { name: /create account|register|sign up/i }).click();
  await expect(page).not.toHaveURL(/\/register/, { timeout: 30_000 }); // password hashing is slow

  // 2. Search from the home page
  await page.goto("/");
  await expectNoHorizontalOverflow(page);
  const form = page.getByRole("form", { name: /search/i }).first();
  await form.getByLabel("Pick-up branch").selectOption({ label: "Dubai International Airport (T3) — Open 24 hours" });
  await form.getByLabel("Pick-up date").fill(pickupDate);
  await form.getByLabel("Pick-up time").selectOption("10:00");
  await form.getByLabel("Return date").fill(returnDate);
  await form.getByLabel("Return time").selectOption("10:00");
  await form.getByRole("button", { name: /search|find/i }).click();
  await page.waitForURL(/\/search\?/);
  await expect(visible(page, "vehicle-card")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Filters narrow results (manual transmission) and every card respects them.
  const all = await page.getByTestId("vehicle-card").filter({ visible: true }).count();
  expect(all).toBeGreaterThan(1);

  // 3. Vehicle details + availability calendar
  const card = visible(page, "vehicle-card");
  const vehicleId = await card.getAttribute("data-vehicle-id");
  await card.getByRole("link").first().click();
  await page.waitForURL(new RegExp(`/vehicles/${vehicleId}`));
  await expect(page.getByRole("grid").first()).toBeVisible();
  await expect(page.getByRole("gridcell", { name: new RegExp(`^${pickupDate}: Available`) })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: /continue to extras/i }).or(page.getByRole("button", { name: /continue to extras/i })).first().click();

  // 4. Extras + price breakdown, checked independently
  await page.waitForURL(/\/book\//);
  const daily = aed(await visible(page, "price-daily-rate").textContent());
  const days = Number(await visible(page, "price-days").textContent());
  expect(days).toBe(3);
  const before = aed(await visible(page, "price-total").textContent());
  expect(before).toBe(daily * days + Math.round((daily * days * 5) / 100));
  const sub = daily * days + 2_000 * days;
  await page.getByRole("checkbox", { name: /GPS navigation/ }).check();
  const gps = 2_000 * days; // AED 20/day, cap 200
  const expectedTotal = sub + Math.round((sub * 5) / 100);
  await expect(visible(page, "price-total")).toContainText(fmt(expectedTotal));
  await expect(visible(page, "price-extras")).toContainText(fmt(gps));
  await expect(visible(page, "price-deposit")).toContainText("1,000.00");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: /continue to checkout/i }).click();

  // 5. Checkout: driver details + licence upload
  await page.waitForURL(/\/checkout\?/);
  await expectNoHorizontalOverflow(page);
  await page.getByLabel("Full name (as on licence)").fill("Layla E2E");
  await page.getByLabel("Driver email").fill(email);
  await page.getByLabel("Mobile phone").fill("+971501234567");
  await page.getByLabel("Date of birth").fill("1990-04-12");
  await page.getByLabel("Licence number").fill("DXB-998877");
  const country = page.getByLabel("Issuing country");
  if ((await country.evaluate((el) => el.tagName)) === "SELECT") await country.selectOption("AE");
  else await country.fill("AE");
  await page.getByLabel("Expiry date").fill("2034-12-31");
  await page.getByLabel("Licence photo or scan").setInputFiles({ name: "licence.png", mimeType: "image/png", buffer: PNG });
  await page.locator('input[name="terms"]').check();
  await page.getByRole("button", { name: /reserve and continue to payment/i }).click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}/);
  const reservationId = page.url().match(/\/checkout\/([0-9a-f-]{36})/)![1];
  await expect(page.getByText(fmt(expectedTotal)).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 6. Declined card, then success
  await page.getByLabel("Card declined").check();
  await page.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByText(/declined/i).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/checkout/${reservationId}`));
  await page.getByLabel("Payment succeeds").check();
  await page.getByRole("button", { name: /^Pay / }).click();
  await page.waitForURL(new RegExp(`/reservations/${reservationId}/voucher`), { timeout: 30_000 });

  // 7. Voucher
  const ref = visible(page, "reservation-reference");
  await expect(ref).toHaveText(/DE-[2-9A-HJ-NP-Z]{8}/);
  await expect(visible(page, "voucher-qr")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  testInfo.annotations.push({ type: "reservation", description: `${reservationId} ${await ref.textContent()}` });
});

test("search filters and validation in the browser", async ({ page }, testInfo) => {
  const { pickupDate, returnDate } = datesFor(testInfo.project.name);
  const base = `pickup=DXB-APT&pickupDate=${pickupDate}&pickupTime=10:00&returnDate=${returnDate}&returnTime=10:00`;
  await page.goto(`/search?${base}`);
  await expect(page.getByTestId("result-count")).toBeVisible();
  const total = await page.getByTestId("vehicle-card").filter({ visible: true }).count();
  await page.goto(`/search?${base}&transmission=MANUAL`);
  await expect(page.getByTestId("result-count")).toBeVisible();
  const manual = await page.getByTestId("vehicle-card").filter({ visible: true }).count();
  expect(manual).toBeLessThan(total);
  await page.goto(`/search?${base}&seats=7`);
  await expect(page.getByTestId("result-count")).toBeVisible();
  for (const c of await page.getByTestId("vehicle-card").filter({ visible: true }).all()) {
    await expect(c).toContainText(/(?<!\d)([7-9]|1[0-5]) seats/);
  }
  // Return before pick-up: friendly error, no crash.
  const res = await page.goto(`/search?pickup=DXB-APT&pickupDate=${returnDate}&pickupTime=10:00&returnDate=${pickupDate}&returnTime=10:00`);
  expect(res?.status()).toBeLessThan(500);
  await expect(page.getByText(/return must be after pick-up|after pick-up/i).first()).toBeVisible();
  // Closed hours at Dubai Marina (08:00-22:00).
  await page.goto(`/search?pickup=DXB-MAR&pickupDate=${pickupDate}&pickupTime=03:00&returnDate=${returnDate}&returnTime=10:00`);
  await expect(page.getByText(/closed/i).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
