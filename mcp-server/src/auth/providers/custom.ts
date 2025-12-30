import { OAuthStrategy, type OAuthStrategyConfig } from "../strategies/oauth.js";
import type { OAuthConfig } from "../config.js";

/**
 * Create custom OAuth strategy with user-provided JWKS
 */
export function createCustomProvider(
  config: OAuthConfig,
  convexUrl: string,
  autoCreateWorkspace?: boolean
): OAuthStrategy | null {
  if (config.provider !== "custom") {
    return null;
  }

  if (!config.issuer || !config.jwksUri) {
    console.warn("Custom OAuth configured but OAUTH_ISSUER or OAUTH_JWKS_URI not set");
    return null;
  }

  const strategyConfig: OAuthStrategyConfig = {
    providerName: "custom",
    issuer: config.issuer,
    jwksUri: config.jwksUri,
    audience: config.audience,
    convexUrl,
    autoCreateWorkspace,
  };

  return new OAuthStrategy(strategyConfig);
}
