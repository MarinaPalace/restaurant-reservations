"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      setError("Invalid admin credentials.");
      return;
    }

    router.push("/admin");
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
        <div className="w-full rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <p className="text-center text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">ADMIN ACCESS</p>
          <h1 className="mt-4 text-center text-3xl font-semibold">Hotel Staff Login</h1>

          <div className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-[#413a35]">
              Username
              <input value={username} onChange={(event) => setUsername(event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 text-lg outline-none focus:border-[#8e6b49]" />
            </label>

            <label className="block text-sm font-medium text-[#413a35]">
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 text-lg outline-none focus:border-[#8e6b49]" />
            </label>

            {error ? <p className="rounded-2xl border border-[#f1d5d1] bg-[#fef3f0] p-3 text-sm text-[#a63a2d]">{error}</p> : null}

            <button type="button" onClick={handleSubmit} className="w-full rounded-2xl bg-[#1d1b1a] px-5 py-4 text-lg font-semibold text-white">Sign In</button>
          </div>
        </div>
      </div>
    </main>
  );
}
