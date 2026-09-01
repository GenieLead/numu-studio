import { cookies } from "next/headers";
import { createAuthSession } from "@/app/chatgpt-auth";

const OWNER_EMAIL = process.env.NUMU_OWNER_EMAIL || "owner@numu.studio";
const OWNER_PASSWORD = process.env.NUMU_OWNER_PASSWORD || "numu-admin-2024";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return Response.json({ error: "Email and password are required." }, { status: 400 });
    }

    if (email !== OWNER_EMAIL || password !== OWNER_PASSWORD) {
      return Response.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const session = await createAuthSession(email);
    const store = await cookies();
    store.set("numu_auth_session", session, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Sign in failed." }, { status: 500 });
  }
}
