/**
 * OAuth Dynamic Client Registration (RFC 7591)
 *
 * Handles POST /oauth/register requests from MCP clients.
 * Registers clients locally (not proxied to Auth0).
 */

import type { AuthConfig } from "../auth/config.js";
import { createDCRErrorResponse } from "./errors.js";
import { oauthStorage } from "./storage.js";
import type { DCRRequest, DCRResponse, DCRClientEntry } from "./types.js";

/**
 * Validate a redirect URI.
 * Only allows localhost or HTTPS URIs.
 */
function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);

    // Allow localhost (any port)
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }

    // Require HTTPS for non-localhost
    if (url.protocol !== "https:") {
      return false;
    }

    // Disallow fragments
    if (url.hash) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Handle DCR request from MCP client.
 *
 * @param request - The incoming request
 * @param config - Auth configuration
 * @returns DCR response or error response
 */
export async function handleRegister(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  // Check if DCR is enabled
  if (!config.oauthProxy?.enabled || !config.oauthProxy.dcrEnabled) {
    return createDCRErrorResponse(
      "invalid_request",
      "Dynamic Client Registration is not enabled",
      400
    );
  }

  // Parse JSON body
  let body: DCRRequest;
  try {
    body = (await request.json()) as DCRRequest;
  } catch {
    return createDCRErrorResponse(
      "invalid_request",
      "Invalid JSON request body"
    );
  }

  // Validate redirect_uris (required)
  if (
    !body.redirect_uris ||
    !Array.isArray(body.redirect_uris) ||
    body.redirect_uris.length === 0
  ) {
    return createDCRErrorResponse(
      "invalid_request",
      "redirect_uris is required and must be a non-empty array"
    );
  }

  // Validate each redirect URI
  for (const uri of body.redirect_uris) {
    if (!isValidRedirectUri(uri)) {
      return createDCRErrorResponse(
        "invalid_redirect_uri",
        `Invalid redirect URI: ${uri}. Must be localhost or HTTPS.`
      );
    }
  }

  // Validate grant_types (default to authorization_code)
  const grantTypes = body.grant_types || ["authorization_code"];
  for (const grantType of grantTypes) {
    if (
      grantType !== "authorization_code" &&
      grantType !== "refresh_token"
    ) {
      return createDCRErrorResponse(
        "invalid_request",
        `Unsupported grant_type: ${grantType}`
      );
    }
  }

  // Validate token_endpoint_auth_method (default to none for public clients)
  const tokenEndpointAuthMethod =
    body.token_endpoint_auth_method || "none";
  if (
    tokenEndpointAuthMethod !== "none" &&
    tokenEndpointAuthMethod !== "client_secret_basic" &&
    tokenEndpointAuthMethod !== "client_secret_post"
  ) {
    return createDCRErrorResponse(
      "invalid_request",
      `Unsupported token_endpoint_auth_method: ${tokenEndpointAuthMethod}`
    );
  }

  // Generate client credentials
  const clientId = crypto.randomUUID();
  const clientIdIssuedAt = Math.floor(Date.now() / 1000);

  // Generate client_secret only for confidential clients
  let clientSecret: string | null = null;
  if (tokenEndpointAuthMethod !== "none") {
    // Generate a secure random secret
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    clientSecret = Array.from(secretBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Create client entry
  const clientEntry: DCRClientEntry = {
    clientId,
    clientSecret,
    clientName: body.client_name,
    redirectUris: body.redirect_uris,
    grantTypes,
    tokenEndpointAuthMethod,
    clientIdIssuedAt,
  };

  // Store the client
  oauthStorage.registerClient(clientEntry);

  console.log(
    `[OAuth] Registered new client: ${clientId} (${body.client_name || "unnamed"})`
  );

  // Build response
  const response: DCRResponse = {
    client_id: clientId,
    client_id_issued_at: clientIdIssuedAt,
    redirect_uris: body.redirect_uris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
  };

  // Include client_name if provided
  if (body.client_name) {
    response.client_name = body.client_name;
  }

  // Include client_secret for confidential clients
  if (clientSecret) {
    response.client_secret = clientSecret;
    // Secrets don't expire in this implementation
    response.client_secret_expires_at = 0;
  }

  return new Response(JSON.stringify(response), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
