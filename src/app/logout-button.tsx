"use client";

import { useState, type ReactNode } from "react";

export default function LogoutButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/auth/logout", {
        body: "{}",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.ok || response.status === 401) {
        window.location.replace("/login");
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" className={className} disabled={pending} onClick={logout}>
      {pending ? "Signing out…" : failed ? "Try sign out again" : children}
    </button>
  );
}
