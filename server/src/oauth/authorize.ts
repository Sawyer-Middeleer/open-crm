/**
 * OAuth Authorization Endpoint
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

export async function handleAuthorize(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  if (!config.oauthProxy?.enabled || !config.oauth?.auth0Domain) {
    return createErrorPageResponse("server_error", "OAuth Authorization Server is not configured");
  }

  const responseType = params.get("response_type");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const scope = params.get("scope") || "crm:read";
  const state = params.get("state");
  const resource = params.get("resource");

  if (!responseType) {
    return createErrorPageResponse("invalid_request", ERROR_DESCRIPTIONS.missing_response_type);
  }
  if (responseType !== "code") {
    return createErrorPageResponse("unsupported_response_type", ERROR_DESCRIPTIONS.invalid_response_type);
  }
  if (!clientId) {
    return createErrorPageResponse("invalid_request", ERROR_DESCRIPTIONS.missing_client_id);
  }
  if (!redirectUri) {
    return createErrorPageResponse("invalid_request", ERROR_DESCRIPTIONS.missing_redirect_uri);
  }
  if (!oauthStorage.isValidRedirectUri(clientId, redirectUri)) {
    return createErrorPageResponse("invalid_request", ERROR_DESCRIPTIONS.invalid_redirect_uri);
  }
  if (!codeChallenge) {
    return createErrorRedirectResponse(redirectUri, "invalid_request", ERROR_DESCRIPTIONS.missing_code_challenge, state ?? undefined);
  }
  if (codeChallengeMethod !== "S256") {
    return createErrorRedirectResponse(redirectUri, "invalid_request", ERROR_DESCRIPTIONS.invalid_code_challenge_method, state ?? undefined);
  }
  if (!isValidCodeChallenge(codeChallenge)) {
    return createErrorRedirectResponse(redirectUri, "invalid_request", "Invalid code_challenge format", state ?? undefined);
  }

  const serverCodeVerifier = generateCodeVerifier();
  const serverCodeChallenge = computeS256Challenge(serverCodeVerifier);
  const internalState = generateState();

  oauthStorage.storePKCEPending(
    createPKCEPendingEntry({
      internalState,
      clientState: state ?? undefined,
      serverCodeVerifier,
      clientCodeChallenge: codeChallenge,
      codeChallengeMethod: "S256",
      clientId,
      redirectUri,
      scope,
      resource: resource ?? undefined,
    })
  );

  const auth0Url = new URL(`https://${config.oauth.auth0Domain}/authorize`);
  auth0Url.searchParams.set("client_id", config.oauthProxy.auth0WebClientId);
  auth0Url.searchParams.set("redirect_uri", config.oauthProxy.callbackUrl);
  auth0Url.searchParams.set("response_type", "code");
  auth0Url.searchParams.set("state", internalState);
  auth0Url.searchParams.set("code_challenge", serverCodeChallenge);
  auth0Url.searchParams.set("code_challenge_method", "S256");

  if (config.oauth.auth0Audience) {
    auth0Url.searchParams.set("audience", config.oauth.auth0Audience);
  }

  auth0Url.searchParams.set("scope", `openid email profile ${scope}`);

  console.log(`[OAuth] Redirecting to Auth0 for client ${clientId}`);
  return Response.redirect(auth0Url.toString(), 302);
}
