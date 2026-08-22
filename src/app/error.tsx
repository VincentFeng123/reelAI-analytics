"use client";

import styles from "./dashboard.module.css";
import LogoutButton from "./logout-button";

export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <main className={styles.routeState}>
      <div className={styles.routeStateInner}>
        <p className={styles.microLabel}>PRIVATE OWNER CONSOLE</p>
        <h1>Read interrupted</h1>
        <p>The dashboard could not complete its latest server read.</p>
        <div className={styles.routeStateActions}>
          <button type="button" onClick={reset}>Try again</button>
          <LogoutButton>Sign out and return to login</LogoutButton>
        </div>
      </div>
    </main>
  );
}
