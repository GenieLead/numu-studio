import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  OPENROUTER_SESSION_COOKIE,
  sealOpenRouterKey,
} from "@/lib/openrouter-session";

const PKCE_COOKIE = "numu_openrouter_pkce";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const store = await cookies();
  const verifier = store.get(PKCE_COOKIE)?.value;

  if (!code || !verifier) {
    return NextResponse.redirect(new URL("/?openrouter=expired", request.url));
  }

  try {
    const exchange = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: "S256",
      }),
    });
    if (!exchange.ok) throw new Error(`OpenRouter authorization failed (${exchange.status}).`);
    const payload = (await exchange.json()) as { key?: string };
    if (!payload.key) throw new Error("OpenRouter did not return a generation key.");

    const response = NextResponse.redirect(new URL("/?openrouter=connected", request.url));
    response.cookies.set(OPENROUTER_SESSION_COOKIE, await sealOpenRouterKey(payload.key), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    response.cookies.set(PKCE_COOKIE, "", { maxAge: 0, path: "/" });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?openrouter=failed", request.url));
  }
}
