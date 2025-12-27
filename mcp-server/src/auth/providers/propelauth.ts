import { OAuthStrategy, type OAuthStrategyConfig } from "../strategies/oauth.js";
import type { OAuthConfig } from "../config.js";

/**
 * Create PropelAuth OAuth strategy
 * PropelAuth uses .well-known/jwks.json at the auth URL
 */
export function createPropelAuthProvider(
  config: OAuthConfig,
  convexUrl: string
): OAuthStrategy | null {
  if (config.provider !== "propelauth") {
    return null;
  }

  if (!config.propelAuthUrl) {
    console.warn("PropelAuth configured but PROPELAUTH_AUTH_URL not set");
    return null;
  }

  // PropelAuth JWKS endpoint
  const authUrl = config.propelAuthUrl.replace(/\/$/, "");
  const jwksUri = `${authUrl}/.well-known/jwks.json`;

  const strategyConfig: OAuthStrategyConfig = {
    providerName: "propelauth",
    issuer: authUrl,
    jwksUri,
    convexUrl,
  };

  return new OAuthStrategy(strategyConfig);
}
