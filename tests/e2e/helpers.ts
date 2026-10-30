import { expect, type Page } from "@playwright/test";

/** Fails if the page scrolls horizontally (layout wider than the viewport); names the widest offenders. */
export async function expectNoHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((e) => (e as HTMLElement).offsetParent !== null || e.tagName === "svg")
      .map((e) => ({ e, right: e.getBoundingClientRect().right }))
      .filter((x) => x.right > W + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5)
      .map(
        ({ e, right }) =>
          `<${e.tagName.toLowerCase()} class="${String((e as HTMLElement).className ?? "").slice(0, 80)}"> right=${Math.round(right)} "${(e.textContent ?? "").trim().slice(0, 40)}"`,
      );
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: W, offenders };
  });
  expect(
    r.scrollWidth,
    `horizontal overflow on ${page.url()}: ${r.scrollWidth}px > ${r.clientWidth}px\n${r.offenders.join("\n")}`,
  ).toBeLessThanOrEqual(r.clientWidth + 1);
}
