import { NextResponse } from "next/server";
import { OPENROUTER_SESSION_COOKIE } from "@/lib/openrouter-session";

export async function POST() {
  const response = NextResponse.json({ disconnected: true });
  response.cookies.set(OPENROUTER_SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
