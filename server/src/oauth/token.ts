/**
 * OAuth Token Endpoint
 */

import { createTokenErrorResponse, ERROR_DESCRIPTIONS } from "./errors.js";
import { verifyPKCE } from "./pkce.js";
import { oauthStorage } from "./storage.js";
import type { TokenResponse } from "./types.js";

export async function handleToken(request: Request): Promise<Response> {
  let body: URLSearchParams;
  try {
    body = new URLSearchParams(await request.text());
  } catch {
    return createTokenErrorResponse("invalid_request", "Invalid request body");
  }

  const grantType = body.get("grant_type");
  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const clientId = body.get("client_id");
  const codeVerifier = body.get("code_verifier");

  if (!grantType) {
    return createTokenErrorResponse("invalid_request", ERROR_DESCRIPTIONS.missing_grant_type);
  }
  if (grantType !== "authorization_code") {
    return createTokenErrorResponse("unsupported_grant_type", ERROR_DESCRIPTIONS.invalid_grant_type);
  }
  if (!code) {
    return createTokenErrorResponse("invalid_request", ERROR_DESCRIPTIONS.missing_code);
  }
  if (!redirectUri) {
    return createTokenErrorResponse("invalid_request", ERROR_DESCRIPTIONS.missing_redirect_uri);
  }
  if (!clientId) {
    return createTokenErrorResponse("invalid_request", ERROR_DESCRIPTIONS.missing_client_id);
  }
  if (!codeVerifier) {
    return createTokenErrorResponse("invalid_request", ERROR_DESCRIPTIONS.missing_code_verifier);
  }

  const authCodeEntry = oauthStorage.consumeAuthorizationCode(code);
  if (!authCodeEntry) {
    return createTokenErrorResponse("invalid_grant", ERROR_DESCRIPTIONS.invalid_code);
  }
  if (authCodeEntry.clientId !== clientId) {
    return createTokenErrorResponse("invalid_grant", ERROR_DESCRIPTIONS.client_id_mismatch);
  }
  if (authCodeEntry.redirectUri !== redirectUri) {
    return createTokenErrorResponse("invalid_grant", ERROR_DESCRIPTIONS.redirect_uri_mismatch);
  }
  if (!verifyPKCE(codeVerifier, authCodeEntry.codeChallenge, authCodeEntry.codeChallengeMethod)) {
    return createTokenErrorResponse("invalid_grant", ERROR_DESCRIPTIONS.invalid_code_verifier);
  }

  const tokenResponse: TokenResponse = {
    access_token: authCodeEntry.auth0AccessToken,
    token_type: authCodeEntry.auth0TokenType,
    expires_in: authCodeEntry.auth0ExpiresIn,
    scope: authCodeEntry.scope,
  };

  if (authCodeEntry.auth0IdToken) tokenResponse.id_token = authCodeEntry.auth0IdToken;
  if (authCodeEntry.auth0RefreshToken) tokenResponse.refresh_token = authCodeEntry.auth0RefreshToken;

  console.log(`[OAuth] Token issued for client ${clientId}`);

  return new Response(JSON.stringify(tokenResponse), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
