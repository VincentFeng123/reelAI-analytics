import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_VERSION = "v1";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string, secret: string): boolean {
  const leftDigest = createHmac("sha256", secret).update(left).digest();
  const rightDigest = createHmac("sha256", secret).update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function passwordMatches(
  candidate: string,
  expected: string,
  secret: string,
): boolean {
  return safeEqual(candidate, expected, secret);
}

export function createSessionToken(
  secret: string,
  now = new Date(),
  nonce = randomBytes(18).toString("base64url"),
): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${expiresAt}.${nonce}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  secret: string,
  now = new Date(),
): boolean {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) {
    return false;
  }
  const [version, rawExpiry, nonce, receivedSignature] = parts;
  const expiresAt = Number(rawExpiry);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    version !== TOKEN_VERSION
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= nowSeconds
    || expiresAt > nowSeconds + SESSION_TTL_SECONDS + 60
    || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)
    || !/^[A-Za-z0-9_-]{32,64}$/.test(receivedSignature)
  ) {
    return false;
  }
  const payload = `${version}.${rawExpiry}.${nonce}`;
  return safeEqual(receivedSignature, signature(payload, secret), secret);
}
