import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

test("home page loads without horizontal overflow", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expectNoHorizontalOverflow(page);
});
