import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/me")
        ? {
            id: "topbar-reader",
            username: "reader",
            display_name: "读者",
            is_system_admin: false,
            csrf_token: "test",
          }
        : path.endsWith("/recent-visits")
          ? []
          : { items: [], next_cursor: null },
    });
  });
  await page.goto("/");
});

test("topbar starts expanded and its lower arrow enables hover reveal", async ({
  page,
}) => {
  const dock = page.locator(".topbar-dock");
  const bar = page.locator(".topbar");
  const panel = page.locator(".topbar-panel");
  const collapse = page.getByRole("button", { name: "收起顶部栏" });
  const edge = page.getByRole("button", { name: "展开顶部栏" });
  const search = page.getByRole("textbox", { name: "全局搜索" });
  await page.evaluate(() =>
    localStorage.setItem("wiki:auto-hide-topbar:topbar-reader", "1"),
  );
  await page.reload();
  await expect(dock).toHaveAttribute("data-mode", "expanded");
  await expect(search).toBeVisible();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(collapse.locator("svg")).toHaveCSS(
    "transform",
    "matrix(0, -1, 1, 0, 0, 0)",
  );
  const headerBottom = await bar.evaluate(
    (el) => el.getBoundingClientRect().bottom,
  );
  expect(
    await collapse.evaluate((el) => el.getBoundingClientRect().top),
  ).toBeCloseTo(headerBottom, 0);
  await collapse.click();
  await expect(dock).toHaveAttribute("data-mode", "hidden");
  await expect(edge).toHaveCSS("height", "18px");
  await expect(edge.locator("svg")).toBeVisible();
  await expect(search).toHaveCount(0);
  await expect
    .poll(() => bar.evaluate((el) => el.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(0);
  const main = page.getByRole("main");
  const mainTop = () => main.evaluate((el) => el.getBoundingClientRect().top);
  const foldedTop = await mainTop();
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
  await edge.hover();
  await page.clock.runFor(700);
  await page.mouse.move(400, 300);
  await page.clock.runFor(1100);
  await expect(dock).toHaveAttribute("data-mode", "hidden");
  await edge.hover();
  await page.clock.runFor(999);
  expect(await dock.getAttribute("data-mode")).toBe("hidden");
  await page.clock.runFor(1);
  await expect(dock).toHaveAttribute("data-mode", "revealed");
  await expect(panel).toHaveCSS("transition-duration", "0.2s");
  await expect(panel).toHaveCSS(
    "transition-timing-function",
    /linear\(.*1\.06/,
  );
  await page.clock.runFor(200);
  await expect
    .poll(() => bar.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(0, 0);
  expect(await mainTop()).toBeCloseTo(foldedTop);
  await page.mouse.move(400, 300);
  await expect(dock).toHaveAttribute("data-mode", "hidden");
  await page.keyboard.press("Control+k");
  await expect(search).toBeFocused();
  await search.fill("知识库");
  await page.keyboard.press("Escape");
  await expect(edge).toBeFocused();
  await edge.press("Enter");
  await expect(search).toBeFocused();
  await expect(dock).toHaveAttribute("data-mode", "expanded");
  await expect(search).toHaveValue("知识库");
  await collapse.click();
  await expect(edge).toHaveAttribute("aria-expanded", "false");
  await page.clock.resume();
  await page.reload();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
});

test("clicking the expand arrow keeps the topbar open until collapsed", async ({
  page,
}) => {
  const dock = page.locator(".topbar-dock");
  const collapse = page.getByRole("button", { name: "收起顶部栏" });
  await collapse.click();
  await page.getByRole("button", { name: "展开顶部栏" }).click();
  await page.getByRole("heading", { name: "我的知识库" }).click();
  await expect(dock).toHaveAttribute("data-mode", "expanded");
  await expect(
    page.getByRole("textbox", { name: "全局搜索" }),
  ).toBeInViewport();
  await collapse.click();
  await expect(dock).toHaveAttribute("data-mode", "hidden");
});

test("breadcrumb and upper hover bands keep independent continuous dwell times", async ({
  page,
}) => {
  const dock = page.locator(".topbar-dock");
  const crumb = page.getByRole("navigation", { name: "页面路径" });
  await page.getByRole("button", { name: "收起顶部栏" }).click();
  const row = (await crumb.boundingBox())!;
  const home = (await crumb
    .getByRole("link", { name: "返回工作台" })
    .boundingBox())!;
  const fast = Math.floor(home.y) - 1;
  const slow = Math.ceil(home.y);
  const bottom = Math.floor(row.y + row.height);
  const outside = () => page.mouse.move(400, bottom + 100);
  const mode = () => dock.getAttribute("data-mode");
  await outside();
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));

  // Cross the sidebar/content boundary and both vertical bands without leaving the union.
  await page.mouse.move(50, bottom - 1);
  await page.clock.runFor(1200);
  await page.mouse.move(home.x, fast);
  await page.clock.runFor(700);
  await page.mouse.move(50, slow);
  await page.clock.runFor(599);
  expect(await mode()).toBe("hidden");
  await page.clock.runFor(1);
  await expect(dock).toHaveAttribute("data-mode", "revealed");
  await outside();
  await expect(dock).toHaveAttribute("data-mode", "hidden");

  // Going below the row cancels both timers. Re-entering the row cancels only the fast timer.
  await page.mouse.move(50, slow);
  await page.clock.runFor(2400);
  await page.mouse.move(50, bottom + 1);
  await page.clock.runFor(200);
  await page.mouse.move(50, fast);
  await page.clock.runFor(800);
  await page.mouse.move(home.x, slow);
  await page.clock.runFor(300);
  await page.mouse.move(home.x, fast);
  await page.clock.runFor(999);
  expect(await mode()).toBe("hidden");
  await page.clock.runFor(1);
  await expect(dock).toHaveAttribute("data-mode", "revealed");
  await outside();
  await expect(dock).toHaveAttribute("data-mode", "hidden");

  // Long documents still have a hover target at the screen edge once the path scrolls away.
  await page.setViewportSize({ width: 1000, height: 260 });
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect
    .poll(() => crumb.evaluate((el) => el.getBoundingClientRect().bottom))
    .toBeLessThan(0);
  await page.mouse.move(50, slow);
  await page.clock.runFor(2499);
  expect(await mode()).toBe("hidden");
  await page.clock.runFor(1);
  await expect(dock).toHaveAttribute("data-mode", "revealed");
});

test.describe("touch topbar", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("tapping the expand arrow keeps the topbar open after an outside tap", async ({
    page,
  }) => {
    const collapse = page.getByRole("button", { name: "收起顶部栏" });
    const edge = page.getByRole("button", { name: "展开顶部栏" });
    await collapse.tap();
    await expect(edge).toHaveCSS("height", "28px");
    await edge.tap();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("heading", { name: "我的知识库" }).tap();
    await expect(collapse).toBeVisible();
    await collapse.tap();
    await expect(edge).toBeVisible();
  });
});
