import { NextResponse } from "next/server";
import { randomBase64Url, sha256Base64Url } from "@/lib/encoding";
import {
  OPENROUTER_SESSION_COOKIE,
  openRouterHeaders,
  sealOpenRouterKey,
} from "@/lib/openrouter-session";

const PKCE_COOKIE = "numu_openrouter_pkce";

export async function GET(request: Request) {
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const callbackUrl = new URL("/api/openrouter/callback", request.url).toString();
  const authorize = new URL("https://openrouter.ai/auth");
  authorize.searchParams.set("callback_url", callbackUrl);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("key_label", "NUMU Studio");

  const response = NextResponse.redirect(authorize);
  response.cookies.set(PKCE_COOKIE, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { apiKey?: string } | null;
  const apiKey = body?.apiKey?.trim() ?? "";
  if (apiKey.length < 24) {
    return Response.json({ error: "Paste a valid OpenRouter API key." }, { status: 400 });
  }
  try {
    const verification = await fetch("https://openrouter.ai/api/v1/key", {
      headers: openRouterHeaders(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await verification.json().catch(() => null) as {
      data?: { limit_remaining?: number; limit?: number };
      error?: { message?: string } | string;
    } | null;
    if (!verification.ok) {
      const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message;
      return Response.json({ error: message || "OpenRouter rejected this API key." }, { status: 401 });
    }
    const response = NextResponse.json({
      connected: true,
      remainingUsd: payload?.data?.limit_remaining ?? null,
      limitUsd: payload?.data?.limit ?? null,
    });
    response.cookies.set(OPENROUTER_SESSION_COOKIE, await sealOpenRouterKey(apiKey), {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "OpenRouter did not answer the key check in time. Nothing was stored."
      : "OpenRouter could not verify this key. Nothing was stored.";
    return Response.json({ error: message }, { status: 502 });
  }
}
