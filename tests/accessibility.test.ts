import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("login explains timed backoff and keeps a visible input boundary", async () => {
  const form = await source("src/app/login/login-form.tsx");
  const styles = await source("src/app/login/login.module.css");
  assert.match(form, /response\.status === 429/);
  assert.match(form, /retry-after/);
  assert.match(form, /Too many attempts/);
  assert.match(styles, /border: 1px solid rgba\(247, 247, 245, 0\.42\)/);
});

test("analytics tables and range controls have programmatic names", async () => {
  const dashboard = await source("src/app/dashboard-client.tsx");
  assert.match(dashboard, /<caption className=\{styles\.srOnly\}>Provider usage/);
  assert.match(dashboard, /<caption className=\{styles\.srOnly\}>Highest-volume operations/);
  assert.match(dashboard, /className=\{styles\.rangeControl\} role="group"/);
});
