import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function apiUserEmail(): Promise<string | null> {
  return (await getChatGPTUser())?.email ?? null;
}

export function unauthorized() {
  return Response.json({ error: "Please reopen the private studio and sign in." }, { status: 401 });
}
