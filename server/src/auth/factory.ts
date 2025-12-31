import { AuthManager } from "./manager.js";
import { loadAuthConfig, type AuthConfig } from "./config.js";
import {
  createAuth0Provider,
  createCustomProvider,
} from "./providers/index.js";
import type { AuthProvider } from "./types.js";

/**
 * Create AuthManager with OAuth providers based on configuration
 */
export function createAuthManager(config?: AuthConfig): AuthManager {
  const resolvedConfig = config ?? loadAuthConfig();
  const providers: AuthProvider[] = [];

  // Add OAuth provider if configured
  if (resolvedConfig.oauth) {
    const oauthProvider =
      createAuth0Provider(resolvedConfig.oauth, resolvedConfig.convexUrl, resolvedConfig.autoCreateWorkspace) ??
      createCustomProvider(resolvedConfig.oauth, resolvedConfig.convexUrl, resolvedConfig.autoCreateWorkspace);

    if (oauthProvider) {
      providers.push(oauthProvider);
    }
  }

  if (providers.length === 0) {
    throw new Error(
      "No OAuth provider configured. Set MCP_AUTH_PROVIDER environment variable to 'auth0' or 'custom'."
    );
  }

  return new AuthManager({ providers });
}
