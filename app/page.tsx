import { redirect } from "next/navigation";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { StudioShell } from "@/components/studio/studio-shell";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) redirect("/signin");
  return <StudioShell userName={user.displayName} />;
}
