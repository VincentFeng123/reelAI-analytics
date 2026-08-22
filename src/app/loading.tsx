import styles from "./dashboard.module.css";

export default function Loading() {
  return (
    <main className={styles.routeState} role="status" aria-live="polite">
      <div className={styles.routeStateInner}>
        <span className={styles.loadingMark} aria-hidden="true" />
        <h1>Reading signals</h1>
        <p>Opening the private owner console.</p>
      </div>
    </main>
  );
}
