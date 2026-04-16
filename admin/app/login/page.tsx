"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      if (res.ok) {
        // Hard navigation ensures the cookie is sent on the next request
        window.location.href = "/";
        return;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Incorrect password.");
      }
    } catch {
      setError("Network error — is the admin server running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-yellow-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">✨</div>
          <h1 className="text-2xl font-bold text-amber-900">Positron Admin</h1>
          <p className="text-sm text-amber-600 mt-1">Enter your admin key to continue</p>
        </div>

        <form onSubmit={submit} className="bg-white border border-yellow-200 rounded-2xl shadow-sm p-7">
          <label className="block text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5">
            Admin key
          </label>
          <input
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your admin secret"
            className="w-full border border-yellow-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-yellow-400 font-mono mb-4"
          />

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-amber-900 hover:bg-amber-800 disabled:opacity-50 text-yellow-300 font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? "Signing in…" : "Sign in →"}
          </button>
        </form>
      </div>
    </div>
  );
}
