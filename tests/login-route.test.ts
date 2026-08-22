import assert from "node:assert/strict";
import test from "node:test";

import { POST as login } from "../src/app/api/auth/login/route";

const origin = "http://localhost:3000";
const configuredPassword = "correct-horse-battery-staple";

process.env.ANALYTICS_PASSWORD = configuredPassword;
process.env.ANALYTICS_SESSION_SECRET = "route-test-secret-with-more-than-thirty-two-characters";
process.env.ANALYTICS_PUBLIC_ORIGIN = origin;
process.env.ANALYTICS_TRUSTED_PROXY_HOPS = "1";

function loginRequest(
  password: string,
  ip: string,
  overrides: Record<string, string> = {},
): Request {
  return new Request(`${origin}/api/auth/login`, {
    body: JSON.stringify({ password }),
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": ip,
      ...overrides,
    },
    method: "POST",
  });
}

test("login issues a hardened session cookie only for the configured password", async () => {
  const accepted = await login(loginRequest(configuredPassword, "203.0.113.10"));
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get("set-cookie") || "";
  assert.match(cookie, /reelai_analytics_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);

  const rejected = await login(loginRequest("incorrect-password", "203.0.113.11"));
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get("set-cookie"), null);
});

test("cross-origin attempts cannot consume the same client rate budget", async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await login(loginRequest("wrong-password", "203.0.113.12", {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));
    assert.equal(response.status, 403);
  }
  const sameOriginFailure = await login(loginRequest("wrong-password", "203.0.113.12"));
  assert.equal(sameOriginFailure.status, 401);
});

test("login rejects an oversized body before JSON allocation completes", async () => {
  const response = await login(loginRequest("x".repeat(2_000), "203.0.113.13"));
  assert.equal(response.status, 413);
});

test("ten same-client failures trigger a timed backoff", async () => {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    response = await login(loginRequest("wrong-password", "203.0.113.14"));
  }
  assert.equal(response?.status, 429);
  assert.ok(Number(response?.headers.get("retry-after")) > 0);
  const blocked = await login(loginRequest(configuredPassword, "203.0.113.14"));
  assert.equal(blocked.status, 429);
});
