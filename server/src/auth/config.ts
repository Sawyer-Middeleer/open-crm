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

export interface ApiKeyConfig {
  enabled: boolean;
}

/**
 * OAuth Authorization Server proxy configuration.
 * When enabled, open-crm acts as an OAuth AS that proxies to Auth0.
 */
export interface OAuthProxyConfig {
  /** Whether OAuth AS proxy is enabled */
  enabled: boolean;
  /** Auth0 web application client ID (for authorization code flow) */
  auth0WebClientId: string;
  /** Auth0 web application client secret */
  auth0WebClientSecret: string;
  /** Callback URL for Auth0 redirects */
  callbackUrl: string;
  /** Whether DCR is enabled */
  dcrEnabled: boolean;
}

export interface AuthConfig {
  // OAuth provider configuration (for token validation)
  oauth?: OAuthConfig;

  // OAuth AS proxy configuration (for authorization flow)
  oauthProxy?: OAuthProxyConfig;

  // API Key configuration
  apiKey?: ApiKeyConfig;

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

  // API Key authentication (enabled by default)
  const apiKeyEnabled = process.env.API_KEY_AUTH_ENABLED !== "false";
  if (apiKeyEnabled) {
    config.apiKey = { enabled: true };
  }

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

  // OAuth AS proxy configuration (for MCP client authorization flow)
  const auth0WebClientId = process.env.AUTH0_WEB_CLIENT_ID;
  const auth0WebClientSecret = process.env.AUTH0_WEB_CLIENT_SECRET;
  const callbackUrl = process.env.OAUTH_CALLBACK_URL;

  if (auth0WebClientId && auth0WebClientSecret && callbackUrl) {
    config.oauthProxy = {
      enabled: true,
      auth0WebClientId,
      auth0WebClientSecret,
      callbackUrl,
      dcrEnabled: process.env.DCR_ENABLED !== "false", // Enabled by default
    };
  }

  return config;
}
