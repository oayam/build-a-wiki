import { test, expect } from "@playwright/test";

for (const reduced of [false, true]) {
  test(`high priority motion: creation, dialogs, sidebar, preview and notices (${reduced ? "reduced" : "normal"})`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByLabel("用户名", { exact: true }).fill("root");
    await page
      .getByLabel("密码", { exact: true })
      .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: /登\s*录/ }).click();
    await expect(
      page.getByRole("heading", { name: "我的知识库", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      const events: string[] = [];
      Object.assign(window, { wikiMotionEvents: events });
      document.addEventListener("animationstart", (event) =>
        events.push(event.animationName),
      );
      document.addEventListener("transitionrun", (event) => {
        if ((event.target as HTMLElement).classList.contains("shell"))
          events.push(`shell:${event.propertyName}`);
        if ((event.target as HTMLElement).classList.contains("motion-collapse"))
          events.push(`collapse:${event.propertyName}`);
      });
    });
    const events = () =>
      page.evaluate(
        () =>
          (window as unknown as { wikiMotionEvents: string[] })
            .wikiMotionEvents,
      );
    const sidebar = page.getByRole("complementary", { name: "知识库导航" });
    await sidebar
      .getByRole("button", { name: "新建知识库", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: "新建知识库", exact: true });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /取\s*消/ }).click();
    await expect(modal).toHaveCount(0);
    if (!reduced) {
      await expect.poll(events).toContain("dialog-arrive");
      await expect.poll(events).toContain("dialog-leave");
    }
    // Both closing and reopening remain operable after a modal's exit animation.
    await sidebar
      .getByRole("button", { name: "新建知识库", exact: true })
      .click();
    const name = `动画验收-${reduced ? "简化" : "标准"}`;
    await modal.getByLabel("新建知识库名称").fill(name);
    await modal.getByRole("button", { name: "确认创建知识库" }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      sidebar
        .locator('[data-created="true"]')
        .getByRole("link", { name: `打开知识库：${name}`, exact: true }),
    ).toBeVisible();
    await sidebar
      .getByRole("button", { name: `创建页面：${name}`, exact: true })
      .click();
    const create = page.getByRole("dialog", { name: "创建页面", exact: true });
    await create.getByLabel("新建页面标题").fill("动画正文");
    await create.getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "动画正文", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar
        .locator('[data-created="true"]')
        .getByRole("link", { name: "打开页面：动画正文", exact: true }),
    ).toBeVisible();
    if (!reduced) await expect.poll(events).toContain("node-highlight");
    // The sidebar and content must share an edge even during a reversed transition.
    const expanded = await sidebar.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    await page
      .getByRole("button", { name: "收起侧栏" })
      .evaluate((el: HTMLButtonElement) => el.click());
    await page
      .getByRole("button", { name: "展开侧栏" })
      .evaluate((el: HTMLButtonElement) => el.click());
    await page
      .getByRole("button", { name: "收起侧栏" })
      .evaluate((el: HTMLButtonElement) => el.click());
    await expect
      .poll(() =>
        sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      )
      .toBe(60);
    await expect(
      sidebar.getByRole("link", { name: "打开页面：动画正文", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "展开侧栏" })
      .evaluate((el: HTMLButtonElement) => el.click());
    const edges = await page.evaluate(async () => {
      const samples: { width: number; gap: number }[] = [];
      for (let frame = 0; frame < 20; frame++) {
        await new Promise(requestAnimationFrame);
        const a = document.querySelector(".sidebar")!.getBoundingClientRect();
        const b = document.querySelector(".content")!.getBoundingClientRect();
        samples.push({ width: a.width, gap: Math.abs(a.right - b.left) });
      }
      return samples;
    });
    expect(
      edges.every(
        (sample) =>
          sample.gap < 1 && sample.width >= 59 && sample.width <= expanded + 1,
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      )
      .toBe(Math.round(expanded));
    if (!reduced)
      expect(
        edges.some(
          (sample) => sample.width > 61 && sample.width < expanded - 1,
        ),
      ).toBe(true);
    await page.getByRole("button", { name: "编辑页面", exact: true }).click();
    await page.locator(".tiptap").fill("动画切换期间保留的正文");
    await page
      .locator(".tiptap")
      .evaluate((el) => el.setAttribute("data-editor-instance", "preserved"));
    for (let i = 0; i < 3; i++) {
      await page
        .getByRole("button", { name: /预\s*览/, exact: true })
        .evaluate((el: HTMLButtonElement) => el.click());
      await expect(page.getByRole("toolbar", { name: "正文格式" })).toHaveCount(
        0,
      );
      await page
        .getByRole("button", { name: "继续编辑", exact: true })
        .evaluate((el: HTMLButtonElement) => el.click());
    }
    await expect(page.getByRole("toolbar", { name: "正文格式" })).toBeVisible();
    await expect(page.locator(".tiptap")).toHaveAttribute(
      "data-editor-instance",
      "preserved",
    );
    await expect(page.locator(".tiptap")).toContainText(
      "动画切换期间保留的正文",
    );
    await page
      .getByRole("button", { name: "保存共享版本", exact: true })
      .click();
    await expect(
      page.getByText("共享版本已保存", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "关闭保存提示", exact: true })
      .click();
    await expect(page.getByText("共享版本已保存", { exact: true })).toHaveCount(
      0,
    );
    if (reduced) {
      expect(await events()).not.toContain("node-highlight");
      expect(await events()).not.toContain("dialog-arrive");
      await expect(page.locator(".shell")).toHaveCSS(
        "transition-duration",
        "0s",
      );
    } else {
      expect(await events()).toContain("shell:grid-template-columns");
      expect(await events()).toContain("collapse:grid-template-rows");
    }
    await expect
      .poll(() =>
        page.locator(".ant-modal-wrap").filter({ visible: true }).count(),
      )
      .toBe(0);
    // The mobile collapse must preserve a working reopen button and avoid overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "收起侧栏" }).click();
    await expect
      .poll(() =>
        sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
      )
      .toBe(49);
    await page.getByRole("button", { name: "展开侧栏" }).click();
    await expect(
      sidebar.getByRole("link", { name: "打开页面：动画正文", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });
}
