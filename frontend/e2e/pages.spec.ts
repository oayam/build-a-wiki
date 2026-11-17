import { test, expect, Page } from "@playwright/test";
async function login(p: Page) {
  await p.goto("/");
  await p.getByLabel("用户名", { exact: true }).fill("root");
  await p.getByLabel("密码", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await p.getByRole("button", { name: /登\s*录/ }).click();
  await expect(p.getByRole("heading", { name: "我的知识库" })).toBeVisible();
}
test("page creation, rich text save and two-browser conflict preserve both versions", async ({
  browser,
  page,
}) => {
  await login(page);
  await page.getByLabel("知识库名称", { exact: true }).fill("版本测试库");
  await page.getByRole("button", { name: "新建私有知识库" }).click();
  await page.getByRole("link", { name: "版本测试库", exact: true }).click();
  await page.getByLabel("新页面标题", { exact: true }).fill("并发页面");
  await page.getByRole("button", { name: "创建页面", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "并发页面", exact: true }),
  ).toBeVisible();
  const url = page.url();
  const c = await browser.newContext();
  const second = await c.newPage();
  await login(second);
  await second.goto(url);
  await expect(
    second.getByRole("heading", { name: "并发页面", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑页面" }).click();
  await second.getByRole("button", { name: "编辑页面" }).click();
  await page.locator(".tiptap").fill("甲的中文内容");
  await second.locator(".tiptap").fill("乙的独立内容");
  await page.getByRole("button", { name: "保存共享版本" }).click();
  await expect(page.getByText("共享版本已保存", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "保存共享版本" }).click();
  await expect(second.getByText(/页面已被其他成员更新/)).toBeVisible();
  await expect(second.locator(".tiptap")).toContainText("乙的独立内容");
  await second.getByRole("button", { name: "查看最新版本" }).click();
  await expect(second.locator("pre")).toContainText("甲的中文内容");
  await expect(second.getByLabel("本地内容副本")).toHaveValue(/乙的独立内容/);
  await c.close();
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.locator(".tiptap")).toContainText("甲的中文内容");
  await expect
    .poll(
      async () =>
        (await page.getByRole("button", { name: "编辑页面" }).isEnabled()) ||
        (await page.getByRole("button", { name: "放弃个人草稿" }).isVisible()),
    )
    .toBe(true);
  if (await page.getByRole("button", { name: "放弃个人草稿" }).isVisible())
    await page.getByRole("button", { name: "放弃个人草稿" }).click();
  await page.getByRole("button", { name: "编辑页面" }).click();
  await page.locator(".tiptap").fill("刷新后恢复的草稿");
  await expect(
    page.getByText("个人草稿已同步（尚未共享）", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("发现未共享的个人草稿", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复个人草稿" }).click();
  await expect(page.locator(".tiptap")).toContainText("刷新后恢复的草稿");
  await page.getByRole("button", { name: "保存共享版本" }).click();
  await expect(page.getByText("共享版本已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "页面设置", exact: true }).click();
  await page.getByRole("link", { name: "版本历史", exact: true }).click();
  await page.getByRole("button", { name: "查看版本2", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "选择的历史正文" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText(/已恢复为新的共享版本/)).toBeVisible();
  await page.getByRole("link", { name: "返回页面", exact: true }).click();
  await expect(page.locator(".tiptap")).toContainText("甲的中文内容");
  await page.getByRole("button", { name: "页面设置", exact: true }).click();
  await page.getByRole("link", { name: "移动与排序", exact: true }).click();
  await page.getByRole("spinbutton", { name: "排序序号" }).fill("-10");
  await page.getByRole("button", { name: "预览移动影响" }).click();
  await expect(page.getByText(/将移动 1 个页面/)).toBeVisible();
  await page.getByRole("button", { name: "确认移动", exact: true }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page).toHaveURL(url);
  await page.getByRole("link", { name: "Build-a-Wiki 首页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近访问" })).toBeVisible();
  await page.getByRole("link", { name: "并发页面", exact: true }).click();
  await expect(page).toHaveURL(url);
  await page.getByRole("button", { name: "编辑页面", exact: true }).click();
  await page.locator(".tiptap").fill("明确放弃的草稿");
  await expect(
    page.getByText("个人草稿已同步（尚未共享）", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "放弃编辑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "编辑页面", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "编辑页面", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".tiptap")).toContainText("甲的中文内容");
  await expect(
    page.getByText("发现未共享的个人草稿", { exact: true }),
  ).toHaveCount(0);
});
