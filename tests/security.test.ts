import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("database access is server-only, explicitly read-only, and uses a dedicated env name", async () => {
  const analytics = await source("src/lib/analytics.ts");
  const client = await source("src/app/dashboard-client.tsx");
  assert.match(analytics, /import "server-only"/);
  assert.match(analytics, /ANALYTICS_DATABASE_URL/);
  assert.doesNotMatch(analytics, /process\.env\.DATABASE_URL/);
  assert.match(analytics, /REPEATABLE READ READ ONLY/);
  assert.match(analytics, /SET LOCAL statement_timeout/);
  assert.doesNotMatch(client, /ANALYTICS_DATABASE_URL|DATABASE_URL|pg\b/);
});

test("the private API authenticates before opening the database path and disables caching", async () => {
  const route = await source("src/app/api/overview/route.ts");
  assert.ok(route.indexOf("hasValidSession(token)") < route.indexOf("getAnalyticsOverview(days)"));
  assert.match(route, /private, no-store/);
  assert.match(route, /status: 401/);
  assert.match(route, /isAnalyticsRangeDays/);
});

test("the standalone site exposes owner sections at root without product-account coupling", async () => {
  const page = await source("src/app/dashboard-client.tsx");
  for (const section of ["Growth", "Journey", "Engagement", "Pipeline", "Economics"]) {
    assert.match(page, new RegExp(`label=\"${section}\"`));
  }
  assert.match(page, /\/api\/overview\?days=/);
  assert.doesNotMatch(page, /COMMUNITY_AUTH|localStorage|return_to=analytics|\/account/);
});

test("example owner credentials are deliberately rejected by runtime length gates", async () => {
  const example = await source(".env.example");
  const password = example.match(/^ANALYTICS_PASSWORD=(.*)$/m)?.[1] || "";
  const sessionSecret = example.match(/^ANALYTICS_SESSION_SECRET=(.*)$/m)?.[1] || "";
  assert.ok(password.length < 16);
  assert.ok(sessionSecret.length < 32);
});

test("login bounds request bodies and backs off repeated failures", async () => {
  const route = await source("src/app/api/auth/login/route.ts");
  assert.match(route, /MAX_LOGIN_BODY_BYTES = 1_024/);
  assert.match(route, /request\.body\.getReader\(\)/);
  assert.match(route, /MAX_LOGIN_FAILURES = 10/);
  assert.match(route, /LOGIN_BACKOFF_MS = 15 \* 60 \* 1_000/);
  assert.match(route, /"Retry-After"/);
  assert.match(route, /status: 429/);
  assert.match(route, /ANALYTICS_TRUSTED_PROXY_HOPS/);
  assert.match(route, /isTrustedSameOriginRequest\(request\)/);
  assert.match(route, /status: 403/);
  assert.doesNotMatch(route, /all-clients/);
});

test("all local environment variants stay out of git", async () => {
  const ignore = await source(".gitignore");
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});

test("logout requires an authenticated same-origin request", async () => {
  const route = await source("src/app/api/auth/logout/route.ts");
  assert.match(route, /isTrustedSameOriginRequest\(request\)/);
  assert.match(route, /status: 403/);
  assert.match(route, /hasValidSession\(token\)/);
  assert.match(route, /status: 401/);
  assert.match(route, /AuthConfigurationError/);
  assert.match(route, /status: 503/);
  const button = await source("src/app/logout-button.tsx");
  assert.match(button, /fetch\("\/api\/auth\/logout"/);
  assert.match(button, /credentials: "same-origin"/);
  assert.match(button, /window\.location\.replace\("\/login"\)/);
});

test("browser origin checks use an explicit public production origin", async () => {
  const origin = await source("src/lib/request-origin.ts");
  assert.match(origin, /ANALYTICS_PUBLIC_ORIGIN/);
  assert.match(origin, /parsed\.protocol !== "https:"/);
  assert.match(origin, /sec-fetch-site/);
});

test("idle PostgreSQL pool errors are handled without logging credentials", async () => {
  const analytics = await source("src/lib/analytics.ts");
  assert.match(analytics, /analyticsPool\.on\("error"/);
  assert.doesNotMatch(analytics, /console\.error\([^)]*error/);
});
