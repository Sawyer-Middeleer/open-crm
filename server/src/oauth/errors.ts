/**
 * OAuth error responses (RFC 6749)
 */

import type { OAuthErrorCode, OAuthErrorResponse } from "./types.js";

export function createOAuthError(
  error: OAuthErrorCode,
  description?: string,
  state?: string
): OAuthErrorResponse {
  const response: OAuthErrorResponse = { error };
  if (description) response.error_description = description;
  if (state) response.state = state;
  return response;
}

export function buildErrorRedirect(
  redirectUri: string,
  error: OAuthErrorCode,
  description?: string,
  state?: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function createErrorRedirectResponse(
  redirectUri: string,
  error: OAuthErrorCode,
  description?: string,
  state?: string
): Response {
  return Response.redirect(buildErrorRedirect(redirectUri, error, description, state), 302);
}

export function createTokenErrorResponse(
  error: OAuthErrorCode,
  description?: string,
  statusCode = 400
): Response {
  const body: OAuthErrorResponse = { error };
  if (description) body.error_description = description;

  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

export function createDCRErrorResponse(
  error: OAuthErrorCode,
  description?: string,
  statusCode = 400
): Response {
  return createTokenErrorResponse(error, description, statusCode);
}

export function createErrorPageResponse(
  error: OAuthErrorCode,
  description: string
): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Error</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    h1 { color: #dc2626; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Authorization Error</h1>
  <p><strong>Error:</strong> <code>${escapeHtml(error)}</code></p>
  <p><strong>Description:</strong> ${escapeHtml(description)}</p>
  <p>Please close this window and try again.</p>
</body>
</html>`;

  return new Response(html, {
    status: 400,
    headers: { "Content-Type": "text/html" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const ERROR_DESCRIPTIONS = {
  missing_response_type: "The response_type parameter is required",
  invalid_response_type: "The response_type must be 'code'",
  missing_client_id: "The client_id parameter is required",
  missing_redirect_uri: "The redirect_uri parameter is required",
  invalid_redirect_uri: "The redirect_uri is not valid or not registered",
  missing_code_challenge: "PKCE is required. The code_challenge parameter is missing",
  invalid_code_challenge_method: "The code_challenge_method must be 'S256'",
  invalid_scope: "The requested scope is invalid or not supported",
  missing_grant_type: "The grant_type parameter is required",
  invalid_grant_type: "The grant_type must be 'authorization_code'",
  missing_code: "The authorization code is required",
  invalid_code: "The authorization code is invalid or expired",
  missing_code_verifier: "The code_verifier parameter is required for PKCE",
  invalid_code_verifier: "The code_verifier does not match the code_challenge",
  redirect_uri_mismatch: "The redirect_uri does not match the authorization request",
  client_id_mismatch: "The client_id does not match the authorization request",
  server_error: "An unexpected error occurred",
} as const;
