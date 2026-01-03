/**
 * OAuth Dynamic Client Registration (RFC 7591)
 */

import type { AuthConfig } from "../auth/config.js";
import { createDCRErrorResponse } from "./errors.js";
import { oauthStorage } from "./storage.js";
import type { DCRRequest, DCRResponse, DCRClientEntry } from "./types.js";

function isValidRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    if (url.protocol !== "https:") return false;
    if (url.hash) return false;
    return true;
  } catch {
    return false;
  }
}

export async function handleRegister(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  if (!config.oauthProxy?.enabled || !config.oauthProxy.dcrEnabled) {
    return createDCRErrorResponse("invalid_request", "Dynamic Client Registration is not enabled", 400);
  }

  let body: DCRRequest;
  try {
    body = (await request.json()) as DCRRequest;
  } catch {
    return createDCRErrorResponse("invalid_request", "Invalid JSON request body");
  }

  if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return createDCRErrorResponse("invalid_request", "redirect_uris is required and must be a non-empty array");
  }

  for (const uri of body.redirect_uris) {
    if (!isValidRedirectUri(uri)) {
      return createDCRErrorResponse("invalid_redirect_uri", `Invalid redirect URI: ${uri}. Must be localhost or HTTPS.`);
    }
  }

  const grantTypes = body.grant_types || ["authorization_code"];
  for (const grantType of grantTypes) {
    if (grantType !== "authorization_code" && grantType !== "refresh_token") {
      return createDCRErrorResponse("invalid_request", `Unsupported grant_type: ${grantType}`);
    }
  }

  const tokenEndpointAuthMethod = body.token_endpoint_auth_method || "none";
  if (!["none", "client_secret_basic", "client_secret_post"].includes(tokenEndpointAuthMethod)) {
    return createDCRErrorResponse("invalid_request", `Unsupported token_endpoint_auth_method: ${tokenEndpointAuthMethod}`);
  }

  const clientId = crypto.randomUUID();
  const clientIdIssuedAt = Math.floor(Date.now() / 1000);

  let clientSecret: string | null = null;
  if (tokenEndpointAuthMethod !== "none") {
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    clientSecret = Array.from(secretBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const clientEntry: DCRClientEntry = {
    clientId,
    clientSecret,
    clientName: body.client_name,
    redirectUris: body.redirect_uris,
    grantTypes,
    tokenEndpointAuthMethod,
    clientIdIssuedAt,
  };

  oauthStorage.registerClient(clientEntry);
  console.log(`[OAuth] Registered new client: ${clientId} (${body.client_name || "unnamed"})`);

  const response: DCRResponse = {
    client_id: clientId,
    client_id_issued_at: clientIdIssuedAt,
    redirect_uris: body.redirect_uris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
  };

  if (body.client_name) response.client_name = body.client_name;
  if (clientSecret) {
    response.client_secret = clientSecret;
    response.client_secret_expires_at = 0;
  }

  return new Response(JSON.stringify(response), {
    status: 201,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
