import { it, expect, vi, afterEach } from "vitest";
import { health, ApiFailure } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("requests same-origin health and returns the contract response", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", request);
  expect(await health()).toEqual({ status: "ok" });
  expect(request).toHaveBeenCalledWith(
    "/health/ready",
    expect.objectContaining({ credentials: "same-origin" }),
  );
});
it("keeps structured service errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "NOT_READY",
          message: "服务尚未就绪",
          request_id: "123",
          details: {},
        }),
        { status: 503 },
      ),
    ),
  );
  await expect(health()).rejects.toMatchObject({
    status: 503,
    detail: { code: "NOT_READY", request_id: "123" },
  });
});
it("handles non-JSON gateway errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("gateway error", { status: 502 })),
  );
  await expect(health()).rejects.toBeInstanceOf(ApiFailure);
});
