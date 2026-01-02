/**
 * PKCE (Proof Key for Code Exchange) Utilities
 *
 * Implements RFC 7636 PKCE with S256 method only.
 * Plain method is intentionally not supported as it provides no security benefit.
 */

import { createHash, randomBytes } from "crypto";

/**
 * Generate a cryptographically secure code verifier.
 * Returns a 43-128 character base64url-encoded string.
 *
 * @returns Random code verifier string
 */
export function generateCodeVerifier(): string {
  // 32 bytes = 43 characters in base64url (after removing padding)
  return randomBytes(32).toString("base64url");
}

/**
 * Generate a random state parameter for CSRF protection.
 *
 * @returns Random state string
 */
export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Generate a random authorization code.
 *
 * @returns Random authorization code string
 */
export function generateAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Compute S256 code challenge from a code verifier.
 * challenge = BASE64URL(SHA256(verifier))
 *
 * @param verifier - The code verifier
 * @returns The code challenge (S256)
 */
export function computeS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Verify PKCE: check if SHA256(verifier) matches the challenge.
 *
 * @param codeVerifier - The code verifier from the token request
 * @param codeChallenge - The code challenge from the authorize request
 * @param method - The challenge method (must be S256)
 * @returns True if verification passes
 */
export function verifyPKCE(
  codeVerifier: string,
  codeChallenge: string,
  method: string
): boolean {
  // Only support S256 - plain is insecure
  if (method !== "S256") {
    return false;
  }

  // Validate verifier length (RFC 7636: 43-128 characters)
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }

  // Compute and compare
  const computedChallenge = computeS256Challenge(codeVerifier);
  return computedChallenge === codeChallenge;
}

/**
 * Validate that a code challenge is properly formatted.
 *
 * @param codeChallenge - The code challenge to validate
 * @returns True if the challenge appears valid
 */
export function isValidCodeChallenge(codeChallenge: string): boolean {
  // S256 challenge should be 43 characters (256 bits in base64url)
  // Allow some flexibility for different encodings
  return codeChallenge.length >= 43 && codeChallenge.length <= 128;
}
