import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ANALYTICS_SESSION_COOKIE,
  AuthConfigurationError,
  hasValidSession,
  sessionCookieOptions,
} from "@/lib/auth";
import {
  isTrustedSameOriginRequest,
  RequestOriginConfigurationError,
} from "@/lib/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let sameOrigin = false;
  try {
    sameOrigin = isTrustedSameOriginRequest(request);
  } catch (error) {
    if (error instanceof RequestOriginConfigurationError) {
      return NextResponse.json({ error: "Owner logout is unavailable." }, {
        headers: { "Cache-Control": "private, no-store" },
        status: 503,
      });
    }
  }
  if (!sameOrigin) {
    return NextResponse.json({ error: "Invalid request origin." }, {
      headers: { "Cache-Control": "private, no-store" },
      status: 403,
    });
  }
  const token = (await cookies()).get(ANALYTICS_SESSION_COOKIE)?.value;
  let authenticated = false;
  try {
    authenticated = hasValidSession(token);
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) {
      console.error("Analytics logout session verification failed unexpectedly.");
    }
    return NextResponse.json({ error: "Owner logout is unavailable." }, {
      headers: { "Cache-Control": "private, no-store" },
      status: 503,
    });
  }
  if (!authenticated) {
    return NextResponse.json({ error: "Authentication required." }, {
      headers: { "Cache-Control": "private, no-store" },
      status: 401,
    });
  }
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  response.cookies.set(ANALYTICS_SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
