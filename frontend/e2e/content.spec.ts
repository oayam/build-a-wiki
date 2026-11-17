import { test, expect } from "@playwright/test";
test("attachments, literal search, trash restore, audit and offline local resources", async ({
  page,
  context,
}) => {
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["127.0.0.1", "localhost"].includes(host)
      ? route.continue()
      : route.abort();
  });
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("root");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.getByLabel("知识库名称", { exact: true }).fill("附件回收验收");
  await page.getByRole("button", { name: "新建私有知识库" }).click();
  await page.getByRole("link", { name: "附件回收验收" }).click();
  await page.getByLabel("新页面标题", { exact: true }).fill("附件百分比100%");
  await page.getByRole("button", { name: "创建页面", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "附件百分比100%" }),
  ).toBeVisible();
  const url = page.url();
  await page
    .getByLabel("选择附件")
    .setInputFiles({
      name: "中文资料.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("仅内网可读的附件"),
    });
  await page.getByRole("button", { name: "上传附件（失败可重试）" }).click();
  const link = page.getByRole("link", { name: "中文资料.txt", exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("仅内网可读的附件");
  await page.getByRole("button", { name: "编辑页面", exact: true }).click();
  await page.getByRole("button", { name: "插入正文", exact: true }).click();
  await page.getByRole("button", { name: "保存共享版本" }).click();
  await expect(page.getByText("共享版本已保存", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "搜索", exact: true }).click();
  await page.getByLabel("搜索关键词").fill("100%");
  await page.getByRole("button", { name: "执行搜索" }).click();
  await page.getByRole("link", { name: "附件百分比100%" }).click();
  await expect(page).toHaveURL(url);
  await page.getByRole("link", { name: "删除页面", exact: true }).click();
  await page.getByRole("button", { name: "预览删除影响" }).click();
  await expect(page.getByText(/本次将删除 1 个页面/)).toBeVisible();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByRole("heading", { name: "回收站" })).toBeVisible();
  expect((await page.request.get(href!)).status()).toBe(404);
  await page.getByRole("button", { name: "恢复页面", exact: true }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(
    page.getByRole("cell", { name: "附件百分比100%", exact: true }),
  ).toHaveCount(0);
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "附件百分比100%" }),
  ).toBeVisible();
  expect((await page.request.get(href!)).status()).toBe(200);
  await page.getByRole("link", { name: "审计与系统状态" }).click();
  await page.getByLabel("审计动作").fill("pages.restore");
  await page.getByRole("button", { name: "筛选日志" }).click();
  await expect(
    page.getByRole("cell", { name: "pages.restore", exact: true }),
  ).toBeVisible();
});
