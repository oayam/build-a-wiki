import type { paths, components } from "./api.generated";
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public detail: components["schemas"]["ApiError"] | null,
  ) {
    super(detail?.message ?? "网络请求失败");
  }
}
export async function health(
  signal?: AbortSignal,
): Promise<
  paths["/health/ready"]["get"]["responses"][200]["content"]["application/json"]
> {
  const response = await fetch("/health/ready", {
    signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    let detail = null;
    try {
      detail = await response.json();
    } catch {
      /* The gateway may return non-JSON errors. */
    }
    throw new ApiFailure(response.status, detail);
  }
  return response.json();
}
