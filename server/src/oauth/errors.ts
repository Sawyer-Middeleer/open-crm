/**
 * OAuth Error Responses (RFC 6749)
 *
 * Implements error responses for OAuth 2.0 authorization and token endpoints.
 */

import type { OAuthErrorCode, OAuthErrorResponse } from "./types.js";

/**
 * Create an OAuth error response object
 */
export function createOAuthError(
  error: OAuthErrorCode,
  description?: string,
  state?: string
): OAuthErrorResponse {
  const response: OAuthErrorResponse = { error };
  if (description) {
    response.error_description = description;
  }
  if (state) {
    response.state = state;
  }
  return response;
}

/**
 * Build error redirect URL for authorization endpoint errors.
 * Per RFC 6749 Section 4.1.2.1, errors are returned via query params on redirect.
 *
 * @param redirectUri - The client's redirect URI
 * @param error - The error code
 * @param description - Optional error description
 * @param state - The state parameter from the request
 * @returns URL to redirect to with error params
 */
export function buildErrorRedirect(
  redirectUri: string,
  error: OAuthErrorCode,
  description?: string,
  state?: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) {
    url.searchParams.set("error_description", description);
  }
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

/**
 * Create a redirect response for authorization endpoint errors.
 */
export function createErrorRedirectResponse(
  redirectUri: string,
  error: OAuthErrorCode,
  description?: string,
  state?: string
): Response {
  const url = buildErrorRedirect(redirectUri, error, description, state);
  return Response.redirect(url, 302);
}

/**
 * Create a JSON error response for token endpoint errors.
 * Per RFC 6749 Section 5.2, token errors are returned as JSON with appropriate status.
 */
export function createTokenErrorResponse(
  error: OAuthErrorCode,
  description?: string,
  statusCode: number = 400
): Response {
  const body: OAuthErrorResponse = { error };
  if (description) {
    body.error_description = description;
  }

  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

/**
 * Create a JSON error response for DCR endpoint errors.
 * RFC 7591 uses similar error format to token endpoint.
 */
export function createDCRErrorResponse(
  error: OAuthErrorCode,
  description?: string,
  statusCode: number = 400
): Response {
  return createTokenErrorResponse(error, description, statusCode);
}

/**
 * Create an HTML error page response for errors that can't be redirected.
 * Used when redirect_uri is invalid or missing.
 */
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

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Standard error descriptions for common OAuth errors
 */
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
