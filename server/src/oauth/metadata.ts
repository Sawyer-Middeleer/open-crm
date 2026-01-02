/**
 * OAuth Authorization Server Metadata (RFC 8414)
 *
 * Returns metadata about this OAuth authorization server.
 */

import type { AuthConfig } from "../auth/config.js";
import { getSupportedScopes } from "../auth/scopes.js";
import type { AuthorizationServerMetadata } from "./types.js";

/**
 * Handle RFC 8414 authorization server metadata request.
 *
 * @param config - Auth configuration
 * @param request - The incoming request (for deriving issuer)
 * @returns Response with authorization server metadata
 */
export function handleAuthorizationServerMetadata(
  config: AuthConfig,
  request: Request
): Response {
  // Check if OAuth proxy is enabled
  if (!config.oauthProxy?.enabled) {
    return new Response(
      JSON.stringify({
        error: "oauth_proxy_not_configured",
        error_description:
          "OAuth Authorization Server proxy is not enabled. Configure AUTH0_WEB_CLIENT_ID, AUTH0_WEB_CLIENT_SECRET, and OAUTH_CALLBACK_URL.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Derive issuer from request URL or config
  const issuer = config.resourceUri
    ? new URL(config.resourceUri).origin
    : new URL(request.url).origin;

  const metadata: AuthorizationServerMetadata = {
    // REQUIRED: Issuer identifier (must match tokens)
    issuer,

    // REQUIRED: Authorization endpoint
    authorization_endpoint: `${issuer}/oauth/authorize`,

    // REQUIRED: Token endpoint
    token_endpoint: `${issuer}/oauth/token`,

    // OPTIONAL: DCR endpoint (if enabled)
    ...(config.oauthProxy.dcrEnabled && {
      registration_endpoint: `${issuer}/oauth/register`,
    }),

    // Supported scopes
    scopes_supported: getSupportedScopes(),

    // Only authorization code flow supported
    response_types_supported: ["code"],

    // Response modes
    response_modes_supported: ["query"],

    // Grant types
    grant_types_supported: ["authorization_code", "refresh_token"],

    // Token endpoint auth methods (public clients use none)
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],

    // PKCE methods (only S256 supported - plain is insecure)
    code_challenge_methods_supported: ["S256"],

    // Documentation
    service_documentation: `${issuer}/api/v1/docs`,
  };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "max-age=3600",
    },
  });
}
