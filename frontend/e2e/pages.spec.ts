import { test, expect, Page } from "@playwright/test";
async function login(p: Page) {
  await p.goto("/");
  await p.getByLabel("用户名", { exact: true }).fill("root");
  await p.getByLabel("密码", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await p.getByRole("button", { name: /登\s*录/ }).click();
  await expect(p.getByRole("heading", { name: "我的知识库" })).toBeVisible();
}
test("page metadata and a live six-level outline follow the saved document", async ({
  page,
}) => {
  await login(page);
  await page.getByLabel("知识库名称", { exact: true }).fill("正文目录验收");
  await page.getByRole("button", { name: "新建私有知识库" }).click();
  await page.getByRole("link", { name: "正文目录验收", exact: true }).click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "创建页面", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "创建页面" });
  await dialog.getByLabel("新建页面标题").fill("多层级文稿");
  await dialog.getByRole("button", { name: "确认创建" }).click();
  const meta = page.locator(".document-meta");
  const header = page.locator(".document-header");
  async function checkTitleSpacing() {
    const gaps = await header.evaluate((el) => {
      const panel = el.parentElement!;
      const content = el.querySelector(".document-heading-block")!;
      const actions = el.querySelector(".document-actions")!;
      return {
        top:
          Math.min(
            content.getBoundingClientRect().top,
            actions.getBoundingClientRect().top,
          ) -
          panel.getBoundingClientRect().top -
          panel.clientTop,
        bottom:
          el.getBoundingClientRect().bottom -
          Math.max(
            content.getBoundingClientRect().bottom,
            actions.getBoundingClientRect().bottom,
          ) -
          parseFloat(getComputedStyle(el).borderBottomWidth),
      };
    });
    expect(gaps.top).toBeCloseTo(14, 0);
    expect(gaps.bottom).toBeCloseTo(gaps.top, 0);
  }
  await checkTitleSpacing();
  const pin = header.getByRole("button", { name: "固定标题栏" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(header).toHaveCSS(
    "border-bottom",
    "1px solid rgb(229, 231, 235)",
  );
  const views = meta.locator("div").filter({ hasText: "浏览量" }).locator("dd");
  const nav = page.getByRole("navigation", { name: "章节目录" });
  await expect(meta).toContainText("root");
  await expect(views).toHaveText("1");
  await expect(nav).toHaveCount(0);
  const created = await meta.locator("time").getAttribute("datetime");
  await page.getByRole("button", { name: "编辑页面", exact: true }).click();
  const editor = page.locator(".tiptap");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  const titles = [
    "总览",
    "设计",
    "重复标题",
    "实现细节与边界条件的完整说明",
    "验证方法",
    "重复标题",
  ];
  for (const [index, title] of titles.entries()) {
    await page.keyboard.type("#".repeat(index + 1) + " ");
    await page.keyboard.insertText(title);
    await expect(
      editor.getByRole("heading", {
        level: index + 1,
        name: title,
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(
      "正文段落。".repeat(index === 2 || index === 3 ? 800 : 1),
    );
    await page.keyboard.press("Enter");
  }
  const marks = nav.getByRole("button");
  await expect(marks).toHaveCount(6);
  const lines = await marks
    .locator("span")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  for (const [index, line] of lines.entries()) {
    expect(line.right).toBeCloseTo(lines[0].right);
    if (index) {
      expect(line.width).toBeLessThan(lines[index - 1].width);
      expect(line.top - lines[index - 1].top).toBeCloseTo(20);
    }
  }
  await page.getByRole("button", { name: /预\s*览/, exact: true }).click();
  const h2 = editor.getByRole("heading", {
    level: 2,
    name: titles[1],
    exact: true,
  });
  await expect(h2).toHaveText(titles[1]);
  expect(
    await h2.evaluate((el) => getComputedStyle(el, "::before").content),
  ).toBe("none");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await expect(views).toHaveText("1");
  await expect(meta.locator("time")).not.toHaveAttribute("datetime", created!);
  await page.reload();
  await expect(views).toHaveText("2");
  await expect(marks).toHaveCount(6);
  const visibleMarks = nav.locator("button[data-visible]");
  const atTop = async (index: number) => {
    const top = await nav.evaluate((el) =>
      parseFloat(getComputedStyle(el).top),
    );
    const heading = editor.getByRole("heading", { level: index + 1 });
    await expect
      .poll(() => heading.evaluate((el) => el.getBoundingClientRect().top))
      .toBeCloseTo(top, 0);
  };
  await marks.first().click();
  await atTop(0);
  await expect(visibleMarks).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(marks.nth(i).locator("span")).toHaveCSS(
      "background-color",
      "rgb(36, 104, 237)",
    );
  }
  const headerBottom = await page
    .locator(".topbar-panel")
    .evaluate((el) => el.getBoundingClientRect().bottom);
  await editor.getByRole("heading", { level: 1 }).evaluate((el, top) => {
    window.scrollBy(0, el.getBoundingClientRect().bottom - top - 2);
  }, headerBottom);
  await expect(visibleMarks).toHaveCount(3);
  await page.evaluate(() => window.scrollBy(0, 4));
  await expect(visibleMarks).toHaveCount(2);
  await expect(marks.first()).not.toHaveAttribute("data-visible", "true");
  // A viewport halfway through a long paragraph contains no heading.
  await page.evaluate(() => window.scrollBy(0, innerHeight));
  await expect(visibleMarks).toHaveCount(0);
  const mark = nav.getByRole("button", { name: `4 级标题：${titles[3]}` });
  const line = mark.locator("span");
  const bounds = () =>
    line.evaluate((el) => el.getBoundingClientRect().toJSON());
  const resting = await bounds();
  await expect(line).toHaveCSS("transition-duration", "0.15s");
  await mark.hover();
  await expect(page.getByRole("tooltip")).toHaveText(titles[3]);
  await expect
    .poll(async () => (await bounds()).width)
    .toBeCloseTo(resting.width * 1.15, 1);
  expect((await bounds()).right).toBeCloseTo(resting.right);
  await expect(line).toHaveCSS("background-color", "rgb(168, 181, 199)");
  const firstFrame = await mark.evaluate(async (button) => {
    const rail = button.closest("nav")!;
    const before = rail.getBoundingClientRect();
    (button as HTMLButtonElement).click();
    await new Promise(requestAnimationFrame);
    const after = rail.getBoundingClientRect();
    return {
      highlighted: button.hasAttribute("data-visible"),
      tooltip: [...document.querySelectorAll('[role="tooltip"]')].some(
        (el) =>
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== "hidden",
      ),
      shifted:
        Math.abs(after.right - before.right) > 1 ||
        Math.abs(after.top - before.top) > 1,
    };
  });
  expect(firstFrame).toEqual({
    highlighted: true,
    tooltip: false,
    shifted: false,
  });
  await atTop(3);
  await expect(mark).toHaveAttribute("data-visible", "true");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => (await bounds()).width)
    .toBeCloseTo(resting.width, 1);
  // The last heading has only one short paragraph after it.
  await marks.last().click();
  await atTop(5);
  await expect(visibleMarks).toHaveCount(1);
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await marks.first().click();
  await atTop(0);
  await expect
    .poll(() => header.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(headerBottom, 0);
  const pinnedBottom = await header.evaluate(
    (el) => el.getBoundingClientRect().bottom,
  );
  const firstHeading = editor.getByRole("heading", { level: 1 });
  expect(
    await firstHeading.evaluate((el) => el.getBoundingClientRect().top),
  ).toBeGreaterThan(pinnedBottom);
  await firstHeading.evaluate(
    (el, top) =>
      window.scrollBy(0, el.getBoundingClientRect().bottom - top + 1),
    pinnedBottom,
  );
  await expect(marks.first()).not.toHaveAttribute("data-visible", "true");
  await expect(marks.nth(1)).toHaveAttribute("data-visible", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await marks.nth(4).focus();
  await page.keyboard.press("Tab");
  await expect(marks.last()).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText(titles[5]);
  await marks.last().press("Enter");
  await atTop(5);
  await expect(page.getByRole("tooltip")).toBeHidden();
  const mobileTopbar = await page.locator(".topbar-panel").boundingBox();
  expect(mobileTopbar!.y).toBeCloseTo(0, 0);
  await expect
    .poll(() => header.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(mobileTopbar!.height, 0);
  const mobileBottom = await header.evaluate(
    (el) => el.getBoundingClientRect().bottom,
  );
  expect(
    await editor
      .getByRole("heading", { level: 6 })
      .evaluate((el) => el.getBoundingClientRect().top),
  ).toBeGreaterThan(mobileBottom);
  await expect(marks.last()).toHaveAttribute("data-visible", "true");
  await page.getByRole("button", { name: "收起顶部栏" }).click();
  const edgeHeight = await page
    .getByRole("button", { name: "展开顶部栏" })
    .evaluate((el) => el.getBoundingClientRect().height);
  await marks.first().click();
  await atTop(0);
  await expect
    .poll(() => header.evaluate((el) => el.getBoundingClientRect().top))
    .toBeCloseTo(edgeHeight, 0);
  await page.reload();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.scrollTo(0, 0));
  await checkTitleSpacing();
  await marks.last().click();
  await atTop(5);
  expect(
    await header.evaluate((el) => el.getBoundingClientRect().bottom),
  ).toBeLessThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
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
  await expect(editor).toHaveAttribute("contenteditable", "true");
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
