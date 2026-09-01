import { cookies } from "next/headers";
import { fromBase64Url, toBase64Url } from "@/lib/encoding";

export const OPENROUTER_SESSION_COOKIE = "numu_openrouter_session";

type RuntimeEnvironment = {
  NUMU_SESSION_SECRET?: string;
};

function sessionSecret(): string {
  const value = (process.env as unknown as RuntimeEnvironment).NUMU_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("NUMU_SESSION_SECRET is not configured.");
  }
  return value;
}

async function encryptionKey(): Promise<CryptoKey> {
  const source = new TextEncoder().encode(sessionSecret());
  const digest = await crypto.subtle.digest("SHA-256", source);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealOpenRouterKey(apiKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    payload,
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openOpenRouterKey(value: string): Promise<string> {
  const [ivValue, ciphertextValue] = value.split(".");
  if (!ivValue || !ciphertextValue) throw new Error("Invalid OpenRouter session.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(fromBase64Url(ivValue)) },
    await encryptionKey(),
    new Uint8Array(fromBase64Url(ciphertextValue)),
  );
  return new TextDecoder().decode(plaintext);
}

export async function getOpenRouterKey(): Promise<string | null> {
  const store = await cookies();
  const sealed = store.get(OPENROUTER_SESSION_COOKIE)?.value;
  if (!sealed) return null;
  try {
    return await openOpenRouterKey(sealed);
  } catch {
    return null;
  }
}

export function openRouterHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://numu-studio.vercel.app",
    "X-Title": "NUMU Studio",
  };
}
