import { test, expect } from "@playwright/test";

const DESKTOP_WIDTH = 1440;
const RESIZED_VIEWPORT = 1000;
const MOBILE_WIDTH = 390;
const VIEWPORT_HEIGHT = 900;
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.45;
const TOPBAR_HEIGHT = 58;
const KEYBOARD_STEP = 16;
const EPSILON = 1;
const TARGET_WIDTH = 420;
const EXPECTED_COLLAPSED_WIDTH = 60;
const ADMIN = {
  id: "resize-user",
  username: "root",
  display_name: "管理员",
  is_system_admin: true,
  csrf_token: "test",
};

test("sidebar divider clamps width, preserves it across navigation and supports keyboard", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: pathname.endsWith("/me")
        ? ADMIN
        : pathname.endsWith("/recent-visits")
          ? []
          : { items: [], next_cursor: null },
    });
  });
  await page.setViewportSize({ width: DESKTOP_WIDTH, height: VIEWPORT_HEIGHT });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "知识库导航" });
  const divider = page.getByRole("separator", { name: "调整目录宽度" });
  const width = () =>
    sidebar.evaluate((el) => el.getBoundingClientRect().width);
  const expectWidth = (expected: number) =>
    expect
      .poll(async () => Math.abs((await width()) - expected))
      .toBeLessThan(EPSILON);
  await expect(divider).toBeVisible();
  expect(
    await page
      .locator(".topbar")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(TOPBAR_HEIGHT);
  expect(await sidebar.evaluate((el) => el.getBoundingClientRect().top)).toBe(
    TOPBAR_HEIGHT,
  );
  const dragTo = async (target: number) => {
    const rect = (await divider.boundingBox())!;
    const start = rect.x + rect.width / 2;
    const initial = await width();
    await page.mouse.move(start, rect.y + 100);
    await page.mouse.down();
    await page.mouse.move(start + target - initial, rect.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".shell")).not.toHaveClass(/sidebar-resizing/);
  };
  await dragTo(TARGET_WIDTH);
  await expectWidth(TARGET_WIDTH);
  await sidebar.getByRole("link", { name: "与我共享", exact: true }).click();
  await expectWidth(TARGET_WIDTH);
  await dragTo(DESKTOP_WIDTH);
  await expectWidth(DESKTOP_WIDTH * MAX_RATIO);
  await expect(divider).toHaveAttribute("aria-valuenow", "45");
  await dragTo(0);
  await expectWidth(DESKTOP_WIDTH * MIN_RATIO);
  await expect(divider).toHaveAttribute("aria-valuenow", "10");
  await divider.focus();
  await divider.press("ArrowRight");
  await expectWidth(DESKTOP_WIDTH * MIN_RATIO + KEYBOARD_STEP);
  await divider.press("End");
  await expectWidth(DESKTOP_WIDTH * MAX_RATIO);
  await page.setViewportSize({
    width: RESIZED_VIEWPORT,
    height: VIEWPORT_HEIGHT,
  });
  await expectWidth(RESIZED_VIEWPORT * MAX_RATIO);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await expect(divider).not.toBeVisible();
  await expectWidth(EXPECTED_COLLAPSED_WIDTH);
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await expectWidth(RESIZED_VIEWPORT * MAX_RATIO);
  await expect(divider).toBeVisible();
  await divider.press("Home");
  await expectWidth(RESIZED_VIEWPORT * MIN_RATIO);
  await page.setViewportSize({ width: MOBILE_WIDTH, height: VIEWPORT_HEIGHT });
  await expect(divider).not.toBeVisible();
  await expectWidth(MOBILE_WIDTH);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});
