import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BYTES_PER_MIB = 1024 ** 2;
const INITIAL_DISK_MIB = 18627;
const ADMIN = {
  id: "status-admin",
  username: "root",
  display_name: "管理员",
  is_system_admin: true,
  csrf_token: "test",
};

test("system summary shows readable capacity and distinct maintenance/retry states", async ({
  page,
}, testInfo) => {
  let status = {
    maintenance: false,
    pending_jobs: 1,
    failed_jobs: 0,
    disk_available_bytes: (INITIAL_DISK_MIB * BYTES_PER_MIB) as number | null,
    disk_warning: false,
    jobs: [],
  };
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith("/me")
      ? ADMIN
      : pathname.endsWith("/system-status")
        ? status
        : { items: [], next_cursor: null };
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/operations");
  const summary = page.getByRole("region", { name: "系统运行概览" });
  await expect(summary).toContainText("已关闭");
  await expect(summary).toContainText("18.2");
  await expect(summary).toContainText("GiB");
  const output = process.env.UI_SCREENSHOT_DIR ?? testInfo.outputPath("ui");
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, "operations-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await summary.scrollIntoViewIfNeeded();
  const bounds = await summary.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await summary.screenshot({
    path: path.join(output, "operations-mobile.png"),
  });
  status = {
    ...status,
    maintenance: true,
    failed_jobs: 2,
    disk_available_bytes: 512 * BYTES_PER_MIB,
    disk_warning: true,
  };
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(summary).toContainText("已开启");
  await expect(summary).toContainText("512");
  await expect(summary).toContainText("MiB");
  await expect(summary.locator(".is-warning")).toHaveCount(3);
  await expect(page.getByRole("alert")).toContainText("附件磁盘空间不足");
  status = { ...status, disk_available_bytes: null };
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(summary).toContainText("暂不可用");
  status = { ...status, disk_available_bytes: 0 };
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(summary).not.toContainText("暂不可用");
  await expect(summary).toContainText("0MiB");
});
