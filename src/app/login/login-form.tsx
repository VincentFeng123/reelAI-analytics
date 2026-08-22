"use client";

import { useState, type FormEvent } from "react";

import styles from "./login.module.css";

export default function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        body: JSON.stringify({ password }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = Number(response.headers.get("retry-after"));
          const minutes = Number.isFinite(seconds)
            ? Math.max(1, Math.ceil(seconds / 60))
            : null;
          setError(minutes
            ? `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
            : "Too many attempts. Wait a few minutes, then try again.");
        } else {
          setError(
            response.status === 503
              ? "The owner login is not configured on this deployment."
              : "That password was not accepted.",
          );
        }
        return;
      }
      window.location.replace("/");
    } catch {
      setError("The private login could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="password">Analytics password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        minLength={16}
        maxLength={512}
        required
        autoFocus
      />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Enter analytics"}
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
