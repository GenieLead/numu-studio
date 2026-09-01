import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

const AUTH_COOKIE = "numu_auth_session";
const AUTH_SECRET = process.env.NUMU_SESSION_SECRET || "numu-default-secret-change-me";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const store = await cookies();
  const session = store.get(AUTH_COOKIE)?.value;
  if (!session) return null;

  try {
    // Simple session validation: email:timestamp:signature
    const parts = session.split(":");
    if (parts.length !== 3) return null;

    const [email, timestamp, signature] = parts;
    const expectedSignature = await hashEmail(email + timestamp + AUTH_SECRET);

    if (signature !== expectedSignature) return null;
    if (Date.now() - parseInt(timestamp, 10) > 7 * 24 * 60 * 60 * 1000) return null;

    return {
      displayName: email.split("@")[0],
      email,
      fullName: null,
    };
  } catch {
    return null;
  }
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/signin?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/signout?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export async function createAuthSession(email: string): Promise<string> {
  const timestamp = Date.now().toString();
  const signature = await hashEmail(email + timestamp + AUTH_SECRET);
  return `${email}:${timestamp}:${signature}`;
}

async function hashEmail(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === "/signin" ||
    pathname === "/signout" ||
    pathname === "/callback"
  );
}
