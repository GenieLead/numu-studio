import { cookies } from "next/headers";

export async function POST() {
  const store = await cookies();
  store.delete("numu_auth_session");
  return Response.json({ success: true });
}
