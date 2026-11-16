import { test, expect, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
async function login(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(
    page.getByRole("heading", { name: "我的知识库", exact: true }),
  ).toBeVisible();
}
async function select(page: Page, label: string, option: string) {
  const combo = page.getByRole("combobox", { name: label, exact: true });
  await combo.focus();
  await combo.press("ArrowDown");
  await page
    .locator(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content",
    )
    .filter({
      hasText: new RegExp(
        "^" + option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
      ),
    })
    .click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "保存权限", exact: true }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText("操作成功", { exact: true })).toBeVisible();
}
test("browser identity → groups → private library → ACL → revoke → independent page", async ({
  browser,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "root");
  await page.getByRole("link", { name: "账号与用户组" }).click();
  for (const name of ["owner", "reader", "editor"]) {
    await page.getByLabel("新账号用户名").fill(name);
    await page.getByLabel("显示名称", { exact: true }).fill(name);
    await page.getByLabel("初始密码").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(
      page.getByRole("cell", { name, exact: true }).first(),
    ).toBeVisible();
  }
  await page.getByLabel("用户组名称").fill("研发组");
  await page.getByRole("button", { name: "创建用户组", exact: true }).click();
  await select(page, "选择用户组", "研发组");
  await select(page, "添加组成员", "editor");
  await page.getByRole("button", { name: "添加成员", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "移除成员", exact: true }),
  ).toBeVisible();
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await login(owner, "owner");
  await owner.getByLabel("知识库名称", { exact: true }).fill("研发知识库");
  await owner.getByRole("button", { name: "新建私有知识库" }).click();
  await owner.getByRole("link", { name: "研发知识库" }).click();
  const url = owner.url();
  const kid = url.split("/").pop()!;
  await select(owner, "添加授权对象", "用户：reader");
  await select(owner, "添加授权对象", "组：研发组");
  await select(owner, "角色-研发组", "编辑者");
  await save(owner);
  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  await login(editor, "editor");
  await editor.getByRole("link", { name: "研发知识库" }).click();
  await expect(editor.getByText(/当前角色：编辑者/)).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "保存权限", exact: true }),
  ).toHaveCount(0);
  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  await login(reader, "reader");
  await reader.getByRole("link", { name: "研发知识库" }).click();
  await expect(reader.getByText(/当前角色：查看者/)).toBeVisible();
  // Group revocation must immediately agree across browser, API and SQL.
  await page.getByRole("button", { name: "移除成员", exact: true }).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(
    page.getByRole("button", { name: "移除成员", exact: true }),
  ).toHaveCount(0);
  await editor.reload();
  await expect(editor.getByText("资源不存在", { exact: true })).toBeVisible();
  const denied = await editor.request.get(`/api/v1/knowledge-bases/${kid}`);
  expect(denied.status()).toBe(404);
  const role = execFileSync(
    "psql",
    [
      process.env.DATABASE_URL!,
      "-tAc",
      `SELECT kb_role((SELECT id FROM users WHERE username='editor'),'${kid}')`,
    ],
    { encoding: "utf8" },
  ).trim();
  expect(role).toBe("0");
  // T23 fixture is inserted directly in the isolated test schema, never via a public test API.
  const pid = "00000000-0000-4000-8000-000000000023",
    rid = "00000000-0000-4000-8000-000000000024";
  execFileSync("psql", [process.env.DATABASE_URL!, "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; INSERT INTO pages(id,knowledge_base_id,title,created_by,current_revision_id) VALUES('${pid}','${kid}','fixture',(SELECT id FROM users WHERE username='owner'),'${rid}'); INSERT INTO page_revisions(id,page_id,revision_no,title,schema_version,body_json,body_text,editor_id) VALUES('${rid}','${pid}',1,'fixture',1,'{}','',(SELECT id FROM users WHERE username='owner')); COMMIT;`,
  });
  await owner.goto(`/pages/${pid}/permissions`);
  await expect(owner.getByRole("heading", { name: "页面权限" })).toBeVisible();
  await select(owner, "授权模式", "独立授权（替换继承）");
  await select(owner, "添加授权对象", "用户：editor");
  await save(owner);
  await editor.goto(`/pages/${pid}/permissions`);
  await expect(editor.getByText(/当前角色：查看者/)).toBeVisible();
  await reader.goto(`/pages/${pid}/permissions`);
  await expect(reader.getByText("资源不存在", { exact: true })).toBeVisible();
  // Invalidated session retains navigation for login recovery.
  execFileSync("psql", [
    process.env.DATABASE_URL!,
    "-c",
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE username='editor')",
  ]);
  await editor.reload();
  await expect(
    editor.getByRole("heading", { name: "登录团队知识库" }),
  ).toBeVisible();
  expect(editor.url()).toContain(pid);
  await owner.screenshot({ path: "/tmp/wiki-permissions.png", fullPage: true });
  expect(errors).toEqual([]);
  await ownerContext.close();
  await editorContext.close();
  await readerContext.close();
});
