import { OAuthStrategy, type OAuthStrategyConfig } from "../strategies/oauth.js";
import type { OAuthConfig } from "../config.js";

/**
 * Create WorkOS OAuth strategy
 * WorkOS uses standard JWKS endpoint at their domain
 */
export function createWorkOSProvider(
  config: OAuthConfig,
  convexUrl: string,
  autoCreateWorkspace?: boolean
): OAuthStrategy | null {
  if (config.provider !== "workos") {
    return null;
  }

  if (!config.workosClientId) {
    console.warn("WorkOS configured but WORKOS_CLIENT_ID not set");
    return null;
  }

  // WorkOS JWKS endpoint
  // https://api.workos.com/sso/jwks/{client_id}
  const jwksUri = `https://api.workos.com/sso/jwks/${config.workosClientId}`;

  const strategyConfig: OAuthStrategyConfig = {
    providerName: "workos",
    issuer: "https://api.workos.com",
    jwksUri,
    convexUrl,
    autoCreateWorkspace,
  };

  return new OAuthStrategy(strategyConfig);
}
