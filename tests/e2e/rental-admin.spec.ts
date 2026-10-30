// QA-9 (admin part) + QA-8 in the browser: admin checks a confirmed rental out and back in,
// records a damage report with a photo; the customer sees nothing of /admin.
import { expect, test, type Page } from "@playwright/test";
import { sql } from "../api/helpers";
import { expectNoHorizontalOverflow } from "./helpers";

const ADMIN = { email: "admin@driveeasy.local", password: "DriveEasyAdmin!1" };
const CUSTOMER = { email: "customer@driveeasy.local", password: "DriveEasyCustomer!1" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

test("admin: check-out, check-in with fuel charge, damage report", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  // One confirmed seeded booking per device project (they run one after another on the same DB).
  const idx = ["desktop-chrome", "mobile-pixel7", "mobile-iphone"].indexOf(testInfo.project.name);
  const rows = await sql<{ id: string; reference: string; vehicle_id: string; mileage_km: number; deposit_fils: number }>(
    `SELECT r.id, r.reference, r.vehicle_id, v.mileage_km, r.deposit_fils FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.status = 'CONFIRMED' AND v.status <> 'ON_RENT' AND r.return_at > now() ORDER BY r.pickup_at, r.id`,
  );
  test.skip(rows.length === 0, "no confirmed reservation left in the seed");
  const r = rows[Math.min(Math.max(idx, 0), rows.length - 1)];

  await login(page, ADMIN);
  await page.goto("/admin/reservations");
  await expectNoHorizontalOverflow(page);
  await page.goto(`/admin/reservations/${r.id}`);
  await expect(page.getByText(r.reference).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Check out
  await page.getByLabel("Odometer (km)").fill(String(r.mileage_km + 5));
  await page.getByLabel("Fuel / charge level (%)").fill("100");
  await page.getByRole("button", { name: /check out vehicle/i }).click();
  await expect.poll(async () => (await sql<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [r.id]))[0].status, { timeout: 20_000 }).toBe("PICKED_UP");
  expect((await sql<{ status: string }>("SELECT status FROM vehicles WHERE id = $1", [r.vehicle_id]))[0].status).toBe("ON_RENT");

  // Check in: 300 km later, 20% less fuel -> 20 × AED 5 = 100.00 + VAT 5.00 = AED 105.00 (returned before the
  // scheduled time, so no late fee).
  await page.reload();
  await page.getByLabel("Odometer (km)").fill(String(r.mileage_km + 305));
  await page.getByLabel("Fuel / charge level (%)").fill("80");
  // Returned one hour after check-out, branch-local (Asia/Dubai = UTC+4). (BUG-6: the prefilled minute fails.)
  const back = new Date(Date.now() + 4 * 3_600_000 + 3_600_000).toISOString();
  await page.getByLabel(/Returned on/).fill(back.slice(0, 10));
  await page.getByLabel("Returned at").fill(back.slice(11, 16));
  await page.getByRole("button", { name: /check in vehicle/i }).click();
  await page.waitForURL(/done=checked-in/, { timeout: 30_000 });
  const summary = page.getByTestId("checkin-summary").filter({ visible: true }).first();
  await expect(summary).toContainText("105.00");
  const [after] = await sql<{ status: string; late_fee_fils: number }>("SELECT status, late_fee_fils FROM reservations WHERE id = $1", [r.id]);
  expect(after).toEqual({ status: "RETURNED", late_fee_fils: 10_500 });
  const deps = await sql<{ status: string; captured_fils: number }>("SELECT status, captured_fils FROM deposits WHERE reservation_id = $1", [r.id]);
  if (deps.length) expect(deps[0]).toMatchObject({ status: "CAPTURED", captured_fils: 10_500 });
  const [v] = await sql<{ status: string; mileage_km: number }>("SELECT status, mileage_km FROM vehicles WHERE id = $1", [r.vehicle_id]);
  expect(v).toEqual({ status: "AVAILABLE", mileage_km: r.mileage_km + 305 });
  await expectNoHorizontalOverflow(page);

  // Damage report with a photo, shown through the private file route
  await page.getByLabel("Description").fill("Scratch on rear bumper");
  await page.getByLabel("Photos").setInputFiles({ name: "damage.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: /save damage report/i }).click();
  const list = page.getByTestId("damage-list").filter({ visible: true }).first();
  await expect(list).toContainText("Scratch on rear bumper", { timeout: 20_000 });
  const img = list.locator("img").first();
  await expect(img).toHaveAttribute("src", /\/api\/files\?key=damage%2F|\/api\/files\?key=damage\//);
});

test("customer cannot see admin pages; my rentals lists their bookings", async ({ page }) => {
  await login(page, CUSTOMER);
  for (const path of ["/admin", "/admin/fleet", "/admin/reservations"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: /admin|fleet/i })).toHaveCount(0);
  }
  await page.goto("/reservations");
  await expect(page.getByTestId("reservation-row").filter({ visible: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
