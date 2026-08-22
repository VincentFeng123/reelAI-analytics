import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import DashboardClient from "@/app/dashboard-client";
import {
  ANALYTICS_SESSION_COOKIE,
  hasValidSession,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ANALYTICS_SESSION_COOKIE)?.value;
  let authenticated = false;
  try {
    authenticated = hasValidSession(token);
  } catch {
    authenticated = false;
  }
  if (!authenticated) {
    redirect("/login");
  }
  return <DashboardClient />;
}
