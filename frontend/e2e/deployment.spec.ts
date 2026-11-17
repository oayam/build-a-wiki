import { test, expect } from "@playwright/test";
test("HTTPS deployment enforces secure session and origin", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.E2E_DEPLOYMENT !== "1",
    "Production-container acceptance only",
  );
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("root");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await expect(page.getByRole("heading", { name: "我的知识库" })).toBeVisible();
  const cookie = (await context.cookies()).find(
    (c) => c.name === "wiki_session",
  );
  expect(cookie?.secure).toBe(true);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  const me = await page.request.get("/api/v1/me");
  const actor = await me.json();
  const denied = await page.request.post("/api/v1/knowledge-bases", {
    headers: {
      Origin: "https://evil.invalid",
      "X-CSRF-Token": actor.csrf_token,
    },
    data: { name: "must-not-create" },
  });
  expect(denied.status()).toBe(403);
  const root = await page.request.get("/");
  expect(root.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(root.headers()["strict-transport-security"]).toContain("max-age");
});
