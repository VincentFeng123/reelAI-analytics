import "server-only";

export class RequestOriginConfigurationError extends Error {
  constructor() {
    super("ANALYTICS_PUBLIC_ORIGIN is not configured safely.");
    this.name = "RequestOriginConfigurationError";
  }
}

function expectedOrigin(request: Request): string {
  const configured = String(process.env.ANALYTICS_PUBLIC_ORIGIN || "").trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new RequestOriginConfigurationError();
    }
    return new URL(request.url).origin;
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new RequestOriginConfigurationError();
  }
  if (
    parsed.origin !== configured.replace(/\/$/, "")
    || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
  ) {
    throw new RequestOriginConfigurationError();
  }
  return parsed.origin;
}

export function isTrustedSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return false;
  }
  try {
    return new URL(origin).origin === expectedOrigin(request);
  } catch (error) {
    if (error instanceof RequestOriginConfigurationError) throw error;
    return false;
  }
}
