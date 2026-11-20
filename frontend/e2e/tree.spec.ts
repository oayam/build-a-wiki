import { test, expect } from "@playwright/test";

test("directory loading does not flash empty state or transient scrollbars", async ({
  page,
}) => {
  let denyChildren = false;
  let release: (() => void) | undefined;
  const pending = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const children = [
    { id: "leaf", title: "子页面", has_children: false, role: 3, position: 0 },
  ];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith("/me"))
      body = {
        id: "tree-user",
        username: "tree",
        display_name: "目录测试",
        is_system_admin: true,
        csrf_token: "test",
      };
    else if (url.pathname.endsWith("/knowledge-bases"))
      body = {
        items: [{ id: "library", name: "目录加载测试库", role: 3 }],
        next_cursor: null,
      };
    else if (url.pathname.endsWith("/recent-visits")) body = [];
    else if (url.pathname.endsWith("/pages")) {
      if (url.searchParams.has("parent_id")) {
        await pending();
        if (denyChildren) {
          await route.fulfill({
            status: 403,
            json: { message: "目录访问权限已撤销" },
          });
          return;
        }
        body = { items: children, next_cursor: null };
      } else
        body = {
          items: [
            {
              id: "parent",
              title: "父页面",
              has_children: true,
              role: 3,
              position: 0,
            },
          ],
          next_cursor: null,
        };
    } else {
      await route.fulfill({ status: 404, json: { message: "资源不存在" } });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "知识库导航" });
  await sidebar
    .getByRole("button", { name: "展开知识库：目录加载测试库" })
    .click();
  await expect(
    sidebar.getByRole("link", { name: "打开页面：父页面", exact: true }),
  ).toBeVisible();
  const settle = () =>
    expect
      .poll(() =>
        page
          .locator('.tree-reveal[aria-hidden="false"]')
          .evaluateAll((elements) =>
            elements.every(
              (el) =>
                getComputedStyle(el).opacity === "1" &&
                el
                  .getAnimations()
                  .every((animation) => animation.playState !== "running"),
            ),
          ),
      )
      .toBe(true);
  await settle();
  // Leave room for precisely one real child row, near the overflow threshold.
  const height = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".sidebar-body")!;
    const footer = body.querySelector("footer")!;
    return Math.ceil(
      footer.getBoundingClientRect().bottom +
        parseFloat(getComputedStyle(body).paddingBottom) +
        document.querySelector(".page-tree-row")!.getBoundingClientRect()
          .height +
        6,
    );
  });
  await page.setViewportSize({ width: 1200, height });
  const metrics = () =>
    page.locator(".sidebar-body").evaluate((el) => ({
      width: el.clientWidth,
      overflowY: el.scrollHeight > el.clientHeight,
      overflowX: el.scrollWidth > el.clientWidth,
    }));
  const before = await metrics();
  expect(before.overflowY).toBe(false);
  await sidebar.getByRole("button", { name: "展开-父页面" }).click();
  await expect.poll(() => !!release).toBe(true);
  const loading = await metrics();
  console.log("directory overflow threshold", { before, loading });
  await expect(sidebar.getByText("暂无内容", { exact: true })).toHaveCount(0, {
    timeout: 1000,
  });
  expect(loading).toEqual(before);
  release!();
  release = undefined;
  await expect(
    sidebar.getByRole("link", { name: "打开页面：子页面", exact: true }),
  ).toBeVisible();
  await settle();
  expect(await metrics()).toEqual(before);
  await sidebar.getByRole("button", { name: "收起-父页面" }).click();
  await sidebar.getByRole("button", { name: "展开-父页面" }).click();
  await expect.poll(() => !!release).toBe(true);
  // Existing rows remain visible while refreshing on a subsequent expansion.
  await expect(
    sidebar.getByRole("link", { name: "打开页面：子页面", exact: true }),
  ).toBeVisible();
  await settle();
  expect(await metrics()).toEqual(before);
  const refreshed = page.waitForResponse((response) =>
    new URL(response.url()).searchParams.has("parent_id"),
  );
  release!();
  release = undefined;
  await refreshed;
  // Real overflow still scrolls, without changing the content width.
  await page.setViewportSize({ width: 1200, height: height - 80 });
  const overflowing = await metrics();
  expect(overflowing.overflowY).toBe(true);
  expect(overflowing.overflowX).toBe(false);
  expect(overflowing.width).toBe(before.width);
  expect(
    await page.locator(".sidebar-body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    }),
  ).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1200, height });
  await settle();
  expect(await metrics()).toEqual(before);
  // Tool navigation must preserve the existing subtree, including manual expansion.
  const leaf = await sidebar
    .getByRole("link", { name: "打开页面：子页面", exact: true })
    .elementHandle();
  for (const name of ["与我共享", "回收站", "服务状态"]) {
    await sidebar.getByRole("link", { name, exact: true }).click();
    await expect(
      sidebar.getByRole("button", { name: "收起-父页面" }),
    ).toBeVisible();
    expect(await leaf!.evaluate((el) => el.isConnected)).toBe(true);
    await expect.poll(() => !!release).toBe(true);
    await expect(
      sidebar.getByRole("link", { name: "打开页面：子页面", exact: true }),
    ).toBeVisible();
    expect(await metrics()).toEqual(before);
    const refreshed = page.waitForResponse((response) =>
      new URL(response.url()).searchParams.has("parent_id"),
    );
    release!();
    release = undefined;
    await refreshed;
  }
  // Cached rows disappear when a refresh reports revoked access.
  denyChildren = true;
  await sidebar.getByRole("button", { name: "收起-父页面" }).click();
  await sidebar.getByRole("button", { name: "展开-父页面" }).click();
  await expect.poll(() => !!release).toBe(true);
  release!();
  release = undefined;
  await expect(sidebar.getByRole("alert")).toContainText("目录访问权限已撤销");
  await expect(
    sidebar.getByRole("link", { name: "打开页面：子页面", exact: true }),
  ).toHaveCount(0);
});
