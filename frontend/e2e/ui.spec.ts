import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("design workspace: tree, formatting, global search, responsive layout", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("root");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByRole("heading", { name: "我的知识库" })).toBeVisible();
  const ids = await page.evaluate(async () => {
    const me = await (await fetch("/api/v1/me")).json();
    const post = async (route: string, data: unknown) => {
      const r = await fetch(`/api/v1${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token,
        },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    };
    const kb = await post("/knowledge-bases", { name: "产品协作知识库" });
    const paragraph = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    const pageData = (title: string, parent_id?: string) => ({
      request_id: crypto.randomUUID(),
      title,
      parent_id,
      schema_version: 1,
      body: { type: "doc", content: [paragraph("团队知识，持续沉淀。")] },
    });
    const parent = await post(
      `/knowledge-bases/${kb.id}/pages`,
      pageData("产品介绍"),
    );
    const article = await post(`/knowledge-bases/${kb.id}/pages`, {
      ...pageData("Build-a-Wiki 使用指南", parent.id),
      body: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Build-a-Wiki 是什么？" }],
          },
          paragraph(
            "Build-a-Wiki 是一个现代化的团队知识库与 Wiki 管理平台，帮助团队高效地创建、组织、编辑和共享知识。",
          ),
          {
            type: "blockquote",
            content: [
              paragraph("核心价值"),
              paragraph(
                "集中管理团队知识，减少信息分散。通过结构化目录与权限管理，让协作更加清晰、安全。",
              ),
            ],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "主要功能" }],
          },
          {
            type: "table",
            content: [
              ["功能模块", "说明"],
              ["内容编辑", "富文本、图片、附件与版本历史"],
              ["知识库管理", "以层级目录组织团队文档"],
              ["权限与共享", "为成员设置查看、编辑和管理权限"],
            ].map((cells, i) => ({
              type: "tableRow",
              content: cells.map((text) => ({
                type: i ? "tableCell" : "tableHeader",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [paragraph(text)],
              })),
            })),
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "快速开始" }],
          },
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              "创建知识库，规划团队的知识结构。",
              "编写第一篇页面，用工具栏整理内容。",
              "邀请成员协作，持续完善团队知识。",
            ].map((text) => ({ type: "listItem", content: [paragraph(text)] })),
          },
        ],
      },
    });
    await post(
      `/knowledge-bases/${kb.id}/pages`,
      pageData("项目概述", parent.id),
    );
    await post(`/knowledge-bases/${kb.id}/pages`, pageData("快速上手"));
    return { kb: kb.id, page: article.id };
  });
  await page.goto(`/pages/${ids.page}`);
  const sidebar = page.getByRole("complementary", { name: "知识库导航" });
  await expect(
    sidebar.getByRole("link", {
      name: "打开页面：Build-a-Wiki 使用指南",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "编辑页面", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "正文格式" })).toBeVisible();
  const output = process.env.UI_SCREENSHOT_DIR ?? testInfo.outputPath("ui");
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, "desktop.png"),
    fullPage: true,
  });
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390)
      await page.getByRole("button", { name: "收起侧栏" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "保存共享版本" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(output, `${width === 390 ? "mobile" : "tablet"}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect(
    sidebar.getByRole("link", {
      name: "打开页面：Build-a-Wiki 使用指南",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "链接", exact: true }).click();
  await page.getByLabel("链接地址").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "应用链接" }).click();
  await expect(page.getByRole("alert")).toContainText("http、https 或 mailto");
  await page.getByRole("button", { name: /取\s*消/, exact: true }).click();
  await page.getByRole("button", { name: /预\s*览/, exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "正文格式" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "文档预览" })).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(page.getByRole("region", { name: "文档预览" })).toHaveCSS(
    "box-shadow",
    "none",
  );
  await expect(page.getByLabel("页面标题", { exact: true })).toHaveCount(0);
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await page.locator(".tiptap").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "粗体", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "粗体", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("UI format verification");
  await page.getByRole("button", { name: "保存共享版本" }).click();
  await expect(page.getByText("共享版本已保存", { exact: true })).toBeVisible();
  await expect(page.getByText("共享版本已保存", { exact: true })).toHaveCount(
    0,
    { timeout: 6500 },
  );
  await page.getByRole("button", { name: "编辑页面", exact: true }).click();
  await page.getByRole("button", { name: "保存共享版本", exact: true }).click();
  await expect(page.getByText("共享版本已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭保存提示", exact: true }).click();
  await expect(page.getByText("共享版本已保存", { exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    page
      .locator(".tiptap strong")
      .filter({ hasText: "UI format verification" }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByLabel("全局搜索")).toBeFocused();
  await page.getByLabel("全局搜索").fill("Build-a-Wiki 使用指南");
  await page.getByLabel("全局搜索").press("Enter");
  await expect(page.getByLabel("搜索关键词")).toHaveValue(
    "Build-a-Wiki 使用指南",
  );
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "Build-a-Wiki 使用指南", exact: true }),
  ).toBeVisible();
  await page.getByLabel("全局搜索").fill("项目概述");
  await page.getByLabel("全局搜索").press("Enter");
  await expect(page.getByLabel("搜索关键词")).toHaveValue("项目概述");
  await expect(
    page.getByRole("main").getByRole("link", { name: "项目概述", exact: true }),
  ).toBeVisible();
  await page.goto(`/pages/${ids.page}`);
  await page.getByRole("button", { name: "编辑页面", exact: true }).click();
  await expect(page.getByRole("main").getByLabel("子页面标题")).toHaveCount(0);
  await sidebar
    .getByRole("button", {
      name: "创建子页面：Build-a-Wiki 使用指南",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "创建子页面", exact: true });
  await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
  await expect(
    dialog.getByText("请输入 1～200 个字符的页面标题"),
  ).toBeVisible();
  await dialog
    .getByLabel("新建页面标题", { exact: true })
    .fill("目录创建的子页面");
  await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "目录创建的子页面", exact: true }),
  ).toBeVisible();
  const childId = page.url().split("/").pop();
  const child = await (
    await page.request.get(`/api/v1/pages/${childId}`)
  ).json();
  expect(child.parent_id).toBe(ids.page);
  await expect(
    sidebar.getByRole("link", {
      name: "打开页面：目录创建的子页面",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  await sidebar
    .getByRole("button", { name: "创建子页面：目录创建的子页面", exact: true })
    .click();
  await dialog.getByLabel("新建页面标题", { exact: true }).fill("下一层子页面");
  await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "下一层子页面", exact: true }),
  ).toBeVisible();
  const grandchild = await (
    await page.request.get(`/api/v1/pages/${page.url().split("/").pop()}`)
  ).json();
  expect(grandchild.parent_id).toBe(childId);
  await sidebar
    .getByRole("button", { name: "创建页面：产品协作知识库", exact: true })
    .click();
  const rootDialog = page.getByRole("dialog", {
    name: "创建页面",
    exact: true,
  });
  await rootDialog
    .getByLabel("新建页面标题", { exact: true })
    .fill("目录创建的顶层页面");
  await rootDialog
    .getByRole("button", { name: "确认创建", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "目录创建的顶层页面", exact: true }),
  ).toBeVisible();
  const rootPage = await (
    await page.request.get(`/api/v1/pages/${page.url().split("/").pop()}`)
  ).json();
  expect(rootPage.parent_id).toBeNull();
  await page.goto(`/pages/${ids.page}`);
  await expect(
    page
      .getByRole("main")
      .getByRole("heading", { name: "子页面", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("main").locator(".page-tree")).toHaveCount(0);
  const collapse = sidebar.getByRole("button", {
    name: "收起-Build-a-Wiki 使用指南",
    exact: true,
  });
  await expect(collapse).toContainText("▲");
  await collapse.click();
  await expect(
    sidebar.getByRole("link", {
      name: "打开页面：目录创建的子页面",
      exact: true,
    }),
  ).toHaveCount(0);
  await sidebar
    .getByRole("button", { name: "展开-Build-a-Wiki 使用指南", exact: true })
    .click();
  await expect(
    sidebar.getByRole("link", {
      name: "打开页面：目录创建的子页面",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "展开-项目概述", exact: true }),
  ).toHaveCount(0);
  await sidebar
    .getByRole("button", { name: "新建知识库", exact: true })
    .click();
  const libraryDialog = page.getByRole("dialog", {
    name: "新建知识库",
    exact: true,
  });
  await libraryDialog
    .getByRole("button", { name: "确认创建知识库", exact: true })
    .click();
  await expect(
    libraryDialog.getByText("请输入 1～100 个字符的知识库名称"),
  ).toBeVisible();
  await libraryDialog
    .getByLabel("新建知识库名称", { exact: true })
    .fill("目录加号创建的知识库");
  await libraryDialog
    .getByRole("button", { name: "确认创建知识库", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "目录加号创建的知识库", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("link", {
      name: "打开知识库：目录加号创建的知识库",
      exact: true,
    }),
  ).toBeVisible();
  await sidebar
    .getByRole("button", {
      name: "创建页面：目录加号创建的知识库",
      exact: true,
    })
    .click();
  await rootDialog
    .getByLabel("新建页面标题", { exact: true })
    .fill("新知识库的首个页面");
  await rootDialog
    .getByRole("button", { name: "确认创建", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "新知识库的首个页面", exact: true }),
  ).toBeVisible();
});
