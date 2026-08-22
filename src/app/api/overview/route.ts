import { NextRequest, NextResponse } from "next/server";

import { getAnalyticsOverview } from "@/lib/analytics";
import {
  ANALYTICS_SESSION_COOKIE,
  AuthConfigurationError,
  hasValidSession,
} from "@/lib/auth";
import { buildDemoOverview } from "@/lib/demo-overview";
import { isAnalyticsRangeDays } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const token = request.cookies.get(ANALYTICS_SESSION_COOKIE)?.value;
  try {
    if (!hasValidSession(token)) {
      return NextResponse.json({ error: "Authentication required." }, {
        headers: noStore,
        status: 401,
      });
    }
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) {
      console.error("Analytics session verification failed unexpectedly.");
    }
    return NextResponse.json({ error: "Owner login is unavailable." }, {
      headers: noStore,
      status: 503,
    });
  }

  const days = Number(request.nextUrl.searchParams.get("days") || "30");
  if (!isAnalyticsRangeDays(days)) {
    return NextResponse.json({ error: "days must be 7, 30, or 90." }, {
      headers: noStore,
      status: 400,
    });
  }
  if (
    process.env.NODE_ENV !== "production"
    && process.env.ANALYTICS_DEMO_MODE === "1"
  ) {
    return NextResponse.json(buildDemoOverview(days), { headers: noStore });
  }
  try {
    const overview = await getAnalyticsOverview(days);
    return NextResponse.json(overview, { headers: noStore });
  } catch {
    console.error("Analytics database read failed.");
    return NextResponse.json({ error: "Analytics are temporarily unavailable." }, {
      headers: noStore,
      status: 503,
    });
  }
}
