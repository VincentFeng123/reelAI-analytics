import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import LoginForm from "./login-form";
import styles from "./login.module.css";
import {
  ANALYTICS_SESSION_COOKIE,
  hasValidSession,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ANALYTICS_SESSION_COOKIE)?.value;
  let authenticated = false;
  try {
    authenticated = hasValidSession(token);
  } catch {
    // The form reports a generic configuration error without exposing secrets.
  }
  if (authenticated) {
    redirect("/");
  }
  return (
    <main className={styles.shell}>
      <div className={styles.ambient} aria-hidden="true" />
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}>
          <Image src="/nosca-logo.svg" alt="" width={36} height={28} priority />
          <span>Nosca / owner analytics</span>
        </div>
        <div className={styles.copy}>
          <p>PRIVATE SIGNAL ROOM</p>
          <h1 id="login-title">Operator access.</h1>
          <span>Use the standalone analytics password. Product account sessions do not grant access here.</span>
        </div>
        <LoginForm />
        <p className={styles.footnote}>Server-only Railway PostgreSQL · no database credentials in the browser</p>
      </section>
    </main>
  );
}
