import { OAuthStrategy, type OAuthStrategyConfig } from "../strategies/oauth.js";
import type { OAuthConfig } from "../config.js";

/**
 * Create Auth0 OAuth strategy
 * Auth0 uses standard OIDC discovery
 */
export function createAuth0Provider(
  config: OAuthConfig,
  convexUrl: string
): OAuthStrategy | null {
  if (config.provider !== "auth0") {
    return null;
  }

  if (!config.auth0Domain) {
    console.warn("Auth0 configured but AUTH0_DOMAIN not set");
    return null;
  }

  // Auth0 JWKS endpoint
  const domain = config.auth0Domain.replace(/\/$/, "");
  const issuer = `https://${domain}/`;
  const jwksUri = `https://${domain}/.well-known/jwks.json`;

  const strategyConfig: OAuthStrategyConfig = {
    providerName: "auth0",
    issuer,
    jwksUri,
    audience: config.auth0Audience,
    convexUrl,
  };

  return new OAuthStrategy(strategyConfig);
}
