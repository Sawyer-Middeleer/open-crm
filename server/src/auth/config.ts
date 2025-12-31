export type AuthProviderType = "auth0" | "custom";

export interface OAuthConfig {
  provider: AuthProviderType;
  // Auth0
  auth0Domain?: string;
  auth0Audience?: string;
  // Custom
  issuer?: string;
  jwksUri?: string;
  audience?: string;
}

export interface AuthConfig {
  // OAuth provider configuration
  oauth?: OAuthConfig;

  // Resource server URI for OAuth metadata
  resourceUri?: string;

  // Convex URL
  convexUrl: string;

  // Auto-create workspace for new users without any workspace memberships
  // Default: true
  autoCreateWorkspace?: boolean;
}

/**
 * Load auth configuration from environment variables
 */
export function loadAuthConfig(): AuthConfig {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable is required");
  }

  const config: AuthConfig = {
    convexUrl,
    resourceUri: process.env.MCP_RESOURCE_URI,
    // Default to true unless explicitly disabled
    autoCreateWorkspace: process.env.DISABLE_AUTO_WORKSPACE !== "true",
  };

  // Determine OAuth provider from environment
  const provider = process.env.MCP_AUTH_PROVIDER as AuthProviderType | undefined;

  if (provider) {
    config.oauth = { provider };

    switch (provider) {
      case "auth0":
        config.oauth.auth0Domain = process.env.AUTH0_DOMAIN;
        config.oauth.auth0Audience = process.env.AUTH0_AUDIENCE;
        break;

      case "custom":
        config.oauth.issuer = process.env.OAUTH_ISSUER;
        config.oauth.jwksUri = process.env.OAUTH_JWKS_URI;
        config.oauth.audience = process.env.OAUTH_AUDIENCE;
        break;
    }
  }

  return config;
}
