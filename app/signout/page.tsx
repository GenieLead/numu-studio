"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignOutPage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/signout", { method: "POST" }).then(() => {
      router.push("/signin");
      router.refresh();
    });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070807]">
      <p className="text-[#96978e]">Signing out...</p>
    </div>
  );
}
