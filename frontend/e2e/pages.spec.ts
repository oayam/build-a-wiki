import { test, expect, Page } from "@playwright/test";
async function login(p: Page) {
  await p.goto("/");
  await p.getByLabel("用户名", { exact: true }).fill("root");
  await p.getByLabel("密码", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await p.getByRole("button", { name: /登\s*录/ }).click();
  await expect(p.getByRole("heading", { name: "我的知识库" })).toBeVisible();
}
test("Markdown tasks keep their checked state across saves and history restore", async ({
  page,
}) => {
  await login(page);
  await page.getByLabel("知识库名称", { exact: true }).fill("待办验收库");
  await page.getByRole("button", { name: "新建私有知识库" }).click();
  await page.getByRole("link", { name: "待办验收库", exact: true }).click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "创建页面", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "创建页面" });
  await dialog.getByLabel("新建页面标题").fill("事项清单");
  await dialog.getByRole("button", { name: "确认创建" }).click();
  const edit = page.getByRole("button", { name: "编辑页面", exact: true });
  const save = page.getByRole("button", { name: "保存", exact: true });
  await edit.click();
  const editor = page.locator(".tiptap");
  await editor.click();
  await page.keyboard.type("- plain bullet");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- [ ] first task");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- [x] second task");
  const first = editor.getByRole("checkbox", { name: "first task" });
  const second = editor.getByRole("checkbox", { name: "second task" });
  await expect(first).not.toBeChecked();
  await expect(second).toBeChecked();
  await expect(editor.locator("ul:not([data-type]) > li")).toHaveText(
    "plain bullet",
  );
  await page.getByRole("button", { name: /预\s*览/, exact: true }).click();
  await first.click();
  await expect(first).not.toBeChecked();
  await save.click();
  await expect(edit).toBeVisible();
  await page.reload();
  await expect(second).toBeChecked();
  await first.click();
  await expect(first).not.toBeChecked();
  await edit.click();
  await first.check();
  await save.click();
  await expect(edit).toBeVisible();
  await expect(first).toBeChecked();
  await page.getByRole("button", { name: "页面设置" }).click();
  await page.getByRole("link", { name: "版本历史" }).click();
  await page.getByRole("button", { name: "查看版本2", exact: true }).click();
  await page.getByRole("button", { name: "恢复此版本" }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText(/已恢复为新版本/)).toBeVisible();
  await page.getByRole("link", { name: "返回页面" }).click();
  await expect(second).toBeChecked();
  await expect(first).not.toBeChecked();
});
for (const width of [1440, 390]) {
  test(`the empty library stays in place from its first frame at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await login(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      /\/knowledge-bases\/[^/]+\/pages(?:\?.*)?$/,
      async (route) => {
        await pending;
        await route.continue();
      },
    );
    const name = `空库布局测试-${width}`;
    await page.getByLabel("知识库名称", { exact: true }).fill(name);
    await page.getByRole("button", { name: "新建私有知识库" }).click();
    await page.getByRole("link", { name, exact: true }).click();
    const main = page.getByRole("main");
    await expect(main.getByRole("status")).toHaveText("正在加载目录…");
    const create = main.getByRole("button", { name: "创建页面", exact: true });
    await expect(create).toBeHidden();
    await expect(main.getByText("暂无内容")).toBeHidden();
    const positions = main.evaluate(async (container) => {
      let hint = container.querySelector(".tree-empty");
      while (!hint) {
        await new Promise(requestAnimationFrame);
        hint = container.querySelector(".tree-empty");
      }
      const button = container.querySelector(".library-create-button")!;
      const frames = [];
      for (let i = 0; i < 24; i++) {
        frames.push([
          hint.getBoundingClientRect().top,
          button.getBoundingClientRect().top,
        ]);
        await new Promise(requestAnimationFrame);
      }
      return frames;
    });
    release();
    const frames = await positions;
    expect(new Set(frames.map(([bookY]) => bookY)).size).toBe(1);
    expect(new Set(frames.map(([, buttonY]) => buttonY)).size).toBe(1);
    await expect(create).toBeVisible();
  });
}
test("page creation, rich text save and exclusive editing survives disconnects", async ({
  browser,
  page,
}) => {
  await login(page);
  await page.getByLabel("知识库名称", { exact: true }).fill("版本测试库");
  await page.getByRole("button", { name: "新建私有知识库" }).click();
  await page.getByRole("link", { name: "版本测试库", exact: true }).click();
  const directory = page.getByRole("main");
  await expect(directory.getByText("暂无内容", { exact: true })).toBeVisible();
  await expect(directory.getByRole("textbox")).toHaveCount(0);
  const createPage = directory.getByRole("button", {
    name: "创建页面",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "创建页面", exact: true });
  await createPage.click();
  await expect(dialog.getByText("创建位置：版本测试库")).toBeVisible();
  await dialog.getByLabel("新建页面标题").press("Escape");
  await expect(createPage).toBeFocused();
  await expect(directory.getByText("暂无内容", { exact: true })).toBeVisible();
  await createPage.click();
  await dialog.getByLabel("新建页面标题").fill("并发页面");
  await dialog.getByRole("button", { name: "确认创建" }).click();
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
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await second.getByRole("button", { name: "编辑页面" }).click();
  await expect(second.getByText(/此文稿正在其他编辑窗口/)).toBeVisible();
  await expect(second.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await page.locator('.tiptap[contenteditable="true"]').fill("甲的中文内容");
  await page.context().setOffline(true);
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "重新获取编辑权" }).click();
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator(".tiptap")).toContainText("甲的中文内容");
  // Commit the first request on the server but drop its response.
  await page.route(
    "**/revisions",
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "重试上次保存" }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "编辑页面" }).click();
  await expect(second.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(second.locator(".tiptap")).toContainText("甲的中文内容");
  await second.getByRole("button", { name: "放弃编辑" }).click();
  await expect(second.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );
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
  await page
    .locator('.tiptap[contenteditable="true"]')
    .fill("刷新后恢复的草稿");
  await expect(page.getByText("个人草稿已同步", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("发现可恢复的个人草稿", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复个人草稿" }).click();
  await expect(page.locator(".tiptap")).toContainText("刷新后恢复的草稿");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "页面设置", exact: true }).click();
  await page.getByRole("link", { name: "版本历史", exact: true }).click();
  await page.getByRole("button", { name: "查看版本2", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "选择的历史正文" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText(/已恢复为新版本/)).toBeVisible();
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
  await page
    .getByRole("link", { name: "Build-a-Wiki 首页", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "最近访问" })).toBeVisible();
  await page.getByRole("link", { name: "并发页面", exact: true }).click();
  await expect(page).toHaveURL(url);
  await page.getByRole("button", { name: "编辑页面", exact: true }).click();
  await page.locator('.tiptap[contenteditable="true"]').fill("明确放弃的草稿");
  await expect(page.getByText("个人草稿已同步", { exact: true })).toBeVisible();
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
    page.getByText("发现可恢复的个人草稿", { exact: true }),
  ).toHaveCount(0);
});
