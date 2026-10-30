import { expect, type Page } from "@playwright/test";

/** Fails if the page scrolls horizontally (layout wider than the viewport). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `horizontal overflow: ${scrollWidth}px > ${clientWidth}px`).toBeLessThanOrEqual(clientWidth + 1);
}
