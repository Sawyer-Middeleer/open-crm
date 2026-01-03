/**
 * PKCE (RFC 7636) utilities - S256 only
 */

import { createHash, randomBytes } from "crypto";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

export function generateAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

export function computeS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPKCE(
  codeVerifier: string,
  codeChallenge: string,
  method: string
): boolean {
  if (method !== "S256") return false;
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  return computeS256Challenge(codeVerifier) === codeChallenge;
}

export function isValidCodeChallenge(codeChallenge: string): boolean {
  return codeChallenge.length >= 43 && codeChallenge.length <= 128;
}
