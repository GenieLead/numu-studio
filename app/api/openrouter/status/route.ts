import { getOpenRouterKey, openRouterHeaders } from "@/lib/openrouter-session";

export async function GET() {
  const key = await getOpenRouterKey();
  if (!key) return Response.json({ connected: false });

  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: openRouterHeaders(key),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return Response.json({ connected: false });
    const payload = (await response.json()) as {
      data?: { limit_remaining?: number; limit?: number };
    };
    return Response.json({
      connected: true,
      remainingUsd: payload.data?.limit_remaining ?? null,
      limitUsd: payload.data?.limit ?? null,
    });
  } catch {
    return Response.json({ connected: false });
  }
}
