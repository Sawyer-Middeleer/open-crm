/**
 * OAuth Callback Endpoint
 */

import type { AuthConfig } from "../auth/config.js";
import { createErrorPageResponse, createErrorRedirectResponse } from "./errors.js";
import { generateAuthorizationCode } from "./pkce.js";
import { oauthStorage, createAuthCodeEntry } from "./storage.js";

interface Auth0TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

export async function handleCallback(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  if (!config.oauthProxy?.enabled || !config.oauth?.auth0Domain) {
    return createErrorPageResponse("server_error", "OAuth Authorization Server is not configured");
  }

  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  if (error) {
    console.error(`[OAuth] Auth0 error: ${error} - ${errorDescription}`);
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
    return createErrorPageResponse("access_denied", errorDescription || "Authentication was denied");
  }

  if (!code || !state) {
    return createErrorPageResponse("invalid_request", "Missing code or state parameter from Auth0");
  }

  const pendingEntry = oauthStorage.consumePKCEPending(state);
  if (!pendingEntry) {
    return createErrorPageResponse("invalid_request", "Invalid or expired state. Please try authenticating again.");
  }

  try {
    const tokenResponse = await exchangeCodeWithAuth0(code, pendingEntry.serverCodeVerifier, config);
    const authCode = generateAuthorizationCode();

    oauthStorage.storeAuthorizationCode(
      createAuthCodeEntry({
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
      })
    );

    const clientRedirectUrl = new URL(pendingEntry.redirectUri);
    clientRedirectUrl.searchParams.set("code", authCode);
    if (pendingEntry.clientState) {
      clientRedirectUrl.searchParams.set("state", pendingEntry.clientState);
    }

    console.log(`[OAuth] Successfully authenticated client ${pendingEntry.clientId}`);
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

async function exchangeCodeWithAuth0(
  code: string,
  codeVerifier: string,
  config: AuthConfig
): Promise<Auth0TokenResponse> {
  if (!config.oauthProxy || !config.oauth?.auth0Domain) {
    throw new Error("OAuth proxy not configured");
  }

  const response = await fetch(`https://${config.oauth.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.oauthProxy.auth0WebClientId,
      client_secret: config.oauthProxy.auth0WebClientSecret,
      redirect_uri: config.oauthProxy.callbackUrl,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[OAuth] Auth0 token exchange failed: ${errorBody}`);
    throw new Error(`Auth0 token exchange failed: ${response.status}`);
  }

  return response.json() as Promise<Auth0TokenResponse>;
}
