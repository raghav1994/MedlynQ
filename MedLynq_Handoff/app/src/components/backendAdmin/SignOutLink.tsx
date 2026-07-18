"use client";

export default function SignOutLink() {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/internal/login";
  }
  return (
    <button onClick={signOut} className="underline hover:text-slate-200">
      Sign out
    </button>
  );
}
