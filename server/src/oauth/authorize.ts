/**
 * OAuth Authorization Endpoint
 *
 * Handles GET /oauth/authorize requests from MCP clients.
 * Validates parameters, stores PKCE state, and redirects to Auth0.
 */

import type { AuthConfig } from "../auth/config.js";
import {
  createErrorPageResponse,
  createErrorRedirectResponse,
  ERROR_DESCRIPTIONS,
} from "./errors.js";
import {
  generateCodeVerifier,
  generateState,
  computeS256Challenge,
  isValidCodeChallenge,
} from "./pkce.js";
import { oauthStorage, createPKCEPendingEntry } from "./storage.js";

/**
 * Handle authorization request from MCP client.
 *
 * @param request - The incoming request
 * @param config - Auth configuration
 * @returns Redirect response to Auth0 or error response
 */
export async function handleAuthorize(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Check if OAuth proxy is configured
  if (!config.oauthProxy?.enabled || !config.oauth?.auth0Domain) {
    return createErrorPageResponse(
      "server_error",
      "OAuth Authorization Server is not configured"
    );
  }

  // Extract required parameters
  const responseType = params.get("response_type");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const scope = params.get("scope") || "crm:read";
  const state = params.get("state");
  const resource = params.get("resource");

  // Validate response_type
  if (!responseType) {
    return createErrorPageResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_response_type
    );
  }
  if (responseType !== "code") {
    return createErrorPageResponse(
      "unsupported_response_type",
      ERROR_DESCRIPTIONS.invalid_response_type
    );
  }

  // Validate client_id
  if (!clientId) {
    return createErrorPageResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_client_id
    );
  }

  // Validate redirect_uri
  if (!redirectUri) {
    return createErrorPageResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_redirect_uri
    );
  }

  // Validate redirect_uri format and registration
  if (!oauthStorage.isValidRedirectUri(clientId, redirectUri)) {
    return createErrorPageResponse(
      "invalid_request",
      ERROR_DESCRIPTIONS.invalid_redirect_uri
    );
  }

  // From this point, we can redirect errors to the client
  // Validate PKCE (mandatory)
  if (!codeChallenge) {
    return createErrorRedirectResponse(
      redirectUri,
      "invalid_request",
      ERROR_DESCRIPTIONS.missing_code_challenge,
      state ?? undefined
    );
  }

  if (codeChallengeMethod !== "S256") {
    return createErrorRedirectResponse(
      redirectUri,
      "invalid_request",
      ERROR_DESCRIPTIONS.invalid_code_challenge_method,
      state ?? undefined
    );
  }

  if (!isValidCodeChallenge(codeChallenge)) {
    return createErrorRedirectResponse(
      redirectUri,
      "invalid_request",
      "Invalid code_challenge format",
      state ?? undefined
    );
  }

  // Generate server's PKCE for Auth0
  const serverCodeVerifier = generateCodeVerifier();
  const serverCodeChallenge = computeS256Challenge(serverCodeVerifier);

  // Generate internal state for Auth0 redirect
  const internalState = generateState();

  // Store PKCE pending entry
  const pendingEntry = createPKCEPendingEntry({
    internalState,
    clientState: state ?? undefined,
    serverCodeVerifier,
    clientCodeChallenge: codeChallenge,
    codeChallengeMethod: "S256",
    clientId,
    redirectUri,
    scope,
    resource: resource ?? undefined,
  });
  oauthStorage.storePKCEPending(pendingEntry);

  // Build Auth0 authorization URL
  const auth0AuthorizeUrl = new URL(
    `https://${config.oauth.auth0Domain}/authorize`
  );

  auth0AuthorizeUrl.searchParams.set(
    "client_id",
    config.oauthProxy.auth0WebClientId
  );
  auth0AuthorizeUrl.searchParams.set(
    "redirect_uri",
    config.oauthProxy.callbackUrl
  );
  auth0AuthorizeUrl.searchParams.set("response_type", "code");
  auth0AuthorizeUrl.searchParams.set("state", internalState);
  auth0AuthorizeUrl.searchParams.set("code_challenge", serverCodeChallenge);
  auth0AuthorizeUrl.searchParams.set("code_challenge_method", "S256");

  // Add audience if configured
  if (config.oauth.auth0Audience) {
    auth0AuthorizeUrl.searchParams.set("audience", config.oauth.auth0Audience);
  }

  // Build scope: combine requested CRM scopes with OIDC scopes
  // Auth0 needs openid for ID token, email/profile for user info
  const auth0Scope = `openid email profile ${scope}`;
  auth0AuthorizeUrl.searchParams.set("scope", auth0Scope);

  console.log(
    `[OAuth] Redirecting to Auth0 for client ${clientId}, internal state: ${internalState}`
  );

  return Response.redirect(auth0AuthorizeUrl.toString(), 302);
}
