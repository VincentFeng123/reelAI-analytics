import { NextResponse } from "next/server";
import { isIP } from "node:net";

import {
  ANALYTICS_SESSION_COOKIE,
  AuthConfigurationError,
  issueSessionToken,
  sessionCookieOptions,
  validatePassword,
} from "@/lib/auth";
import {
  isTrustedSameOriginRequest,
  RequestOriginConfigurationError,
} from "@/lib/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };
const MAX_LOGIN_BODY_BYTES = 1_024;
const MAX_LOGIN_FAILURES = 10;
const LOGIN_BACKOFF_MS = 15 * 60 * 1_000;
const MAX_RATE_LIMIT_KEYS = 1_000;

type LoginFailureState = { failures: number; resetAt: number };

const loginGuard = globalThis as typeof globalThis & {
  reelAiAnalyticsLoginFailures?: Map<string, LoginFailureState>;
};

const loginFailures = loginGuard.reelAiAnalyticsLoginFailures
  || new Map<string, LoginFailureState>();
loginGuard.reelAiAnalyticsLoginFailures = loginFailures;

class BodyTooLargeError extends Error {}
class LoginGuardConfigurationError extends Error {}

function loginClientKey(request: Request): string {
  const rawHops = String(process.env.ANALYTICS_TRUSTED_PROXY_HOPS || "0");
  const trustedHops = Number(rawHops);
  if (
    !Number.isSafeInteger(trustedHops)
    || trustedHops < 0
    || trustedHops > 5
    || (process.env.NODE_ENV === "production" && trustedHops === 0)
  ) {
    throw new LoginGuardConfigurationError();
  }
  if (trustedHops === 0) return "local-client";
  const forwarded = String(request.headers.get("x-forwarded-for") || "");
  const chain = forwarded.split(",").map((value) => value.trim());
  const candidate = chain.at(-trustedHops) || "";
  if (!isIP(candidate)) throw new LoginGuardConfigurationError();
  return `ip:${candidate}`;
}

function pruneLoginFailures(now: number) {
  for (const [key, state] of loginFailures) {
    if (state.resetAt <= now) {
      loginFailures.delete(key);
    }
  }
  while (loginFailures.size >= MAX_RATE_LIMIT_KEYS) {
    const oldest = loginFailures.keys().next().value;
    if (typeof oldest !== "string") break;
    loginFailures.delete(oldest);
  }
}

function retryAfterSeconds(key: string, now: number): number {
  const state = loginFailures.get(key);
  if (!state || state.resetAt <= now || state.failures < MAX_LOGIN_FAILURES) {
    return 0;
  }
  return Math.max(1, Math.ceil((state.resetAt - now) / 1_000));
}

function recordLoginFailure(key: string, now: number) {
  pruneLoginFailures(now);
  const current = loginFailures.get(key);
  loginFailures.set(key, {
    failures: current && current.resetAt > now ? current.failures + 1 : 1,
    resetAt: current && current.resetAt > now
      ? current.resetAt
      : now + LOGIN_BACKOFF_MS,
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const rawLength = request.headers.get("content-length");
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength > MAX_LOGIN_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
  }
  if (!request.body) throw new SyntaxError("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_LOGIN_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function limitedResponse(retryAfter: number) {
  return NextResponse.json({ error: "Too many login attempts." }, {
    headers: { ...noStore, "Retry-After": String(retryAfter) },
    status: 429,
  });
}

export async function POST(request: Request) {
  let sameOrigin = false;
  try {
    sameOrigin = isTrustedSameOriginRequest(request);
  } catch (error) {
    if (error instanceof RequestOriginConfigurationError) {
      return NextResponse.json({ error: "Owner login is unavailable." }, {
        headers: noStore,
        status: 503,
      });
    }
  }
  if (!sameOrigin) {
    return NextResponse.json({ error: "Invalid request origin." }, {
      headers: noStore,
      status: 403,
    });
  }
  const now = Date.now();
  let clientKey: string;
  try {
    clientKey = loginClientKey(request);
  } catch {
    return NextResponse.json({ error: "Owner login is unavailable." }, {
      headers: noStore,
      status: 503,
    });
  }
  const existingBackoff = retryAfterSeconds(clientKey, now);
  if (existingBackoff) return limitedResponse(existingBackoff);

  let password = "";
  try {
    if (!String(request.headers.get("content-type") || "")
      .toLowerCase().startsWith("application/json")) {
      throw new SyntaxError("Expected JSON");
    }
    const payload = await readBoundedJson(request) as { password?: unknown };
    password = typeof payload.password === "string" ? payload.password : "";
  } catch (error) {
    recordLoginFailure(clientKey, now);
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large." }, {
        headers: noStore,
        status: 413,
      });
    }
    return NextResponse.json({ error: "Invalid request." }, {
      headers: noStore,
      status: 400,
    });
  }
  if (password.length > 512) {
    recordLoginFailure(clientKey, now);
    return NextResponse.json({ error: "Invalid credentials." }, {
      headers: noStore,
      status: 401,
    });
  }
  try {
    if (!validatePassword(password)) {
      recordLoginFailure(clientKey, now);
      const backoff = retryAfterSeconds(clientKey, now);
      if (backoff) return limitedResponse(backoff);
      return NextResponse.json({ error: "Invalid credentials." }, {
        headers: noStore,
        status: 401,
      });
    }
    loginFailures.delete(clientKey);
    const response = NextResponse.json({ ok: true }, { headers: noStore });
    response.cookies.set(
      ANALYTICS_SESSION_COOKIE,
      issueSessionToken(),
      sessionCookieOptions(),
    );
    return response;
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) {
      console.error("Analytics login failed unexpectedly.");
    }
    return NextResponse.json({ error: "Owner login is unavailable." }, {
      headers: noStore,
      status: 503,
    });
  }
}
