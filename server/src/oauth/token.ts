/**
 * OAuth Token Endpoint
 *
 * Handles POST /oauth/token requests from MCP clients.
 * Validates PKCE and returns Auth0 tokens.
 */

import {
  createTokenErrorResponse,
  ERROR_DESCRIPTIONS,
} from "./errors.js";
import { verifyPKCE } from "./pkce.js";
import { oauthStorage } from "./storage.js";
import type { TokenResponse } from "./types.js";

/**
 * Handle token request from MCP client.
 *
 * @param request - The incoming request
 * @returns Token response or error response
 */
export async function handleToken(request: Request): Promise<Response> {
  // Parse form body
  let body: URLSearchParams;
  try {
    const text = await request.text();
    body = new URLSearchParams(text);
  } catch {
    return createTokenErrorResponse(
      "invalid_request",
      "Invalid request body"
    );
  }

  // Extract required parameters
  const grantType = body.get("grant_type");
  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const clientId = body.get("client_id");
  const codeVerifier = body.get("code_verifier");

  // Validate grant_type
  if (!grantType) {
    return createTokenErrorResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_grant_type
    );
  }

  if (grantType !== "authorization_code") {
    return createTokenErrorResponse(
      "unsupported_grant_type",
      ERROR_DESCRIPTIONS.invalid_grant_type
    );
  }

  // Validate code
  if (!code) {
    return createTokenErrorResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_code
    );
  }

  // Validate redirect_uri
  if (!redirectUri) {
    return createTokenErrorResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_redirect_uri
    );
  }

  // Validate client_id
  if (!clientId) {
    return createTokenErrorResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_client_id
    );
  }

  // Validate code_verifier (PKCE is mandatory)
  if (!codeVerifier) {
    return createTokenErrorResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_code_verifier
    );
  }

  // Look up and consume the authorization code (single use)
  const authCodeEntry = oauthStorage.consumeAuthorizationCode(code);
  if (!authCodeEntry) {
    return createTokenErrorResponse(
      "invalid_grant",
      ERROR_DESCRIPTIONS.invalid_code
    );
  }

  // Validate client_id matches
  if (authCodeEntry.clientId !== clientId) {
    return createTokenErrorResponse(
      "invalid_grant",
      ERROR_DESCRIPTIONS.client_id_mismatch
    );
  }

  // Validate redirect_uri matches
  if (authCodeEntry.redirectUri !== redirectUri) {
    return createTokenErrorResponse(
      "invalid_grant",
      ERROR_DESCRIPTIONS.redirect_uri_mismatch
    );
  }

  // Verify PKCE
  if (
    !verifyPKCE(
      codeVerifier,
      authCodeEntry.codeChallenge,
      authCodeEntry.codeChallengeMethod
    )
  ) {
    return createTokenErrorResponse(
      "invalid_grant",
      ERROR_DESCRIPTIONS.invalid_code_verifier
    );
  }

  // Build token response with Auth0 tokens
  const tokenResponse: TokenResponse = {
    access_token: authCodeEntry.auth0AccessToken,
    token_type: authCodeEntry.auth0TokenType,
    expires_in: authCodeEntry.auth0ExpiresIn,
    scope: authCodeEntry.scope,
  };

  // Include id_token if present
  if (authCodeEntry.auth0IdToken) {
    tokenResponse.id_token = authCodeEntry.auth0IdToken;
  }

  // Include refresh_token if present
  if (authCodeEntry.auth0RefreshToken) {
    tokenResponse.refresh_token = authCodeEntry.auth0RefreshToken;
  }

  console.log(
    `[OAuth] Token issued for client ${clientId}`
  );

  return new Response(JSON.stringify(tokenResponse), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}
