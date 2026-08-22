import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  passwordMatches,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "../src/lib/auth-core";

const secret = "a-standalone-test-secret-that-is-long-enough";
const now = new Date("2026-08-22T12:00:00.000Z");

test("signed sessions validate only before their expiry", () => {
  const token = createSessionToken(secret, now, "abcdefghijklmnopQRSTUVWX");
  assert.equal(verifySessionToken(token, secret, now), true);
  assert.equal(
    verifySessionToken(
      token,
      secret,
      new Date(now.getTime() + (SESSION_TTL_SECONDS + 1) * 1000),
    ),
    false,
  );
});

test("tampered and differently signed sessions fail closed", () => {
  const token = createSessionToken(secret, now, "abcdefghijklmnopQRSTUVWX");
  assert.equal(verifySessionToken(`${token.slice(0, -1)}A`, secret, now), false);
  assert.equal(
    verifySessionToken(token, "a-different-secret-that-is-also-long-enough", now),
    false,
  );
  assert.equal(verifySessionToken("", secret, now), false);
});

test("password comparison accepts only the exact configured value", () => {
  assert.equal(passwordMatches("correct horse", "correct horse", secret), true);
  assert.equal(passwordMatches("correct-horse", "correct horse", secret), false);
});
