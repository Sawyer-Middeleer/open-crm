/**
 * OAuth Callback Endpoint
 *
 * Handles GET /oauth/callback from Auth0 after user authentication.
 * Exchanges Auth0 code for tokens, generates our own code, and redirects to client.
 */

import type { AuthConfig } from "../auth/config.js";
import {
  createErrorPageResponse,
  createErrorRedirectResponse,
} from "./errors.js";
import { generateAuthorizationCode } from "./pkce.js";
import { oauthStorage, createAuthCodeEntry } from "./storage.js";

/**
 * Response from Auth0 token endpoint
 */
interface Auth0TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

/**
 * Handle callback from Auth0 after user authentication.
 *
 * @param request - The incoming request
 * @param config - Auth configuration
 * @returns Redirect response to client or error response
 */
export async function handleCallback(
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

  // Extract callback parameters
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  // Handle Auth0 errors
  if (error) {
    console.error(`[OAuth] Auth0 error: ${error} - ${errorDescription}`);

    // Try to find the pending entry to redirect back to client
    if (state) {
      const pendingEntry = oauthStorage.consumePKCEPending(state);
      if (pendingEntry) {
        return createErrorRedirectResponse(
          pendingEntry.redirectUri,
          "access_denied",
          errorDescription || "Authentication was denied",
          pendingEntry.clientState
        );
      }
    }

    return createErrorPageResponse(
      "access_denied",
      errorDescription || "Authentication was denied"
    );
  }

  // Validate required parameters
  if (!code || !state) {
    return createErrorPageResponse(
      "invalid_request",
      "Missing code or state parameter from Auth0"
    );
  }

  // Look up the pending PKCE entry
  const pendingEntry = oauthStorage.consumePKCEPending(state);
  if (!pendingEntry) {
    return createErrorPageResponse(
      "invalid_request",
      "Invalid or expired state. Please try authenticating again."
    );
  }

  try {
    // Exchange Auth0 code for tokens
    const tokenResponse = await exchangeCodeWithAuth0(
      code,
      pendingEntry.serverCodeVerifier,
      config
    );

    // Generate our authorization code for the client
    const authCode = generateAuthorizationCode();

    // Store the authorization code entry
    const authCodeEntry = createAuthCodeEntry({
      code: authCode,
      clientId: pendingEntry.clientId,
      redirectUri: pendingEntry.redirectUri,
      codeChallenge: pendingEntry.clientCodeChallenge,
      codeChallengeMethod: pendingEntry.codeChallengeMethod,
      scope: pendingEntry.scope,
      state: pendingEntry.clientState,
      resource: pendingEntry.resource,
      auth0AccessToken: tokenResponse.access_token,
      auth0TokenType: tokenResponse.token_type,
      auth0ExpiresIn: tokenResponse.expires_in,
      auth0IdToken: tokenResponse.id_token,
      auth0RefreshToken: tokenResponse.refresh_token,
    });
    oauthStorage.storeAuthorizationCode(authCodeEntry);

    // Build redirect URL to client
    const clientRedirectUrl = new URL(pendingEntry.redirectUri);
    clientRedirectUrl.searchParams.set("code", authCode);
    if (pendingEntry.clientState) {
      clientRedirectUrl.searchParams.set("state", pendingEntry.clientState);
    }

    console.log(
      `[OAuth] Successfully authenticated client ${pendingEntry.clientId}, redirecting with code`
    );

    return Response.redirect(clientRedirectUrl.toString(), 302);
  } catch (err) {
    console.error("[OAuth] Token exchange failed:", err);

    return createErrorRedirectResponse(
      pendingEntry.redirectUri,
      "server_error",
      "Failed to exchange authorization code",
      pendingEntry.clientState
    );
  }
}

/**
 * Exchange Auth0 authorization code for tokens.
 */
async function exchangeCodeWithAuth0(
  code: string,
  codeVerifier: string,
  config: AuthConfig
): Promise<Auth0TokenResponse> {
  if (!config.oauthProxy || !config.oauth?.auth0Domain) {
    throw new Error("OAuth proxy not configured");
  }

  const tokenUrl = `https://${config.oauth.auth0Domain}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.oauthProxy.auth0WebClientId,
    client_secret: config.oauthProxy.auth0WebClientSecret,
    redirect_uri: config.oauthProxy.callbackUrl,
    code_verifier: codeVerifier,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[OAuth] Auth0 token exchange failed: ${errorBody}`);
    throw new Error(`Auth0 token exchange failed: ${response.status}`);
  }

  return response.json() as Promise<Auth0TokenResponse>;
}
