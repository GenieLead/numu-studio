"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("return_to") || "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Sign in failed");
        return;
      }

      router.push(returnTo);
      router.refresh();
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070807]">
      <div className="w-full max-w-md p-8 bg-[#11120f] rounded-lg border border-white/10">
        <h1 className="text-2xl font-bold text-[#f4f2ec] mb-2">NUMU Studio</h1>
        <p className="text-[#96978e] mb-6">Sign in to your creative director studio</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#f4f2ec] mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#181914] border border-white/10 rounded-md text-[#f4f2ec] focus:outline-none focus:ring-2 focus:ring-[#d9ff57]"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#f4f2ec] mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#181914] border border-white/10 rounded-md text-[#f4f2ec] focus:outline-none focus:ring-2 focus:ring-[#d9ff57]"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-[#ff6b5f] text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-[#d9ff57] text-[#111208] font-medium rounded-md hover:bg-[#c5e84d] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#070807]">
        <p className="text-[#96978e]">Loading...</p>
      </div>
    }>
      <SignInForm />
    </Suspense>
  );
}
