/**
 * OAuth Authorization Server Metadata (RFC 8414)
 */

import type { AuthConfig } from "../auth/config.js";
import { getSupportedScopes } from "../auth/scopes.js";
import type { AuthorizationServerMetadata } from "./types.js";

export function handleAuthorizationServerMetadata(
  config: AuthConfig,
  request: Request
): Response {
  if (!config.oauthProxy?.enabled) {
    return new Response(
      JSON.stringify({
        error: "oauth_proxy_not_configured",
        error_description:
          "OAuth proxy is not enabled. Configure AUTH0_WEB_CLIENT_ID, AUTH0_WEB_CLIENT_SECRET, and OAUTH_CALLBACK_URL.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const issuer = config.resourceUri
    ? new URL(config.resourceUri).origin
    : new URL(request.url).origin;

  const metadata: AuthorizationServerMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    ...(config.oauthProxy.dcrEnabled && {
      registration_endpoint: `${issuer}/oauth/register`,
    }),
    scopes_supported: getSupportedScopes(),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${issuer}/api/v1/docs`,
  };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" },
  });
}
