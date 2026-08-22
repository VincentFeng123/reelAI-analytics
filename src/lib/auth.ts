import "server-only";

import {
  createSessionToken,
  passwordMatches,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "@/lib/auth-core";

export const ANALYTICS_SESSION_COOKIE = "reelai_analytics_session";

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

type AuthConfiguration = {
  password: string;
  sessionSecret: string;
};

function authConfiguration(): AuthConfiguration {
  const password = String(process.env.ANALYTICS_PASSWORD || "");
  const sessionSecret = String(process.env.ANALYTICS_SESSION_SECRET || "");
  if (password.length < 16) {
    throw new AuthConfigurationError(
      "ANALYTICS_PASSWORD must contain at least 16 characters.",
    );
  }
  if (sessionSecret.length < 32) {
    throw new AuthConfigurationError(
      "ANALYTICS_SESSION_SECRET must contain at least 32 characters.",
    );
  }
  return { password, sessionSecret };
}

export function validatePassword(candidate: string): boolean {
  const config = authConfiguration();
  return passwordMatches(candidate, config.password, config.sessionSecret);
}

export function issueSessionToken(now = new Date()): string {
  return createSessionToken(authConfiguration().sessionSecret, now);
}

export function hasValidSession(
  token: string | null | undefined,
  now = new Date(),
): boolean {
  return verifySessionToken(token, authConfiguration().sessionSecret, now);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    priority: "high" as const,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
