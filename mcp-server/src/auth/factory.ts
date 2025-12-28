import { AuthManager } from "./manager.js";
import { loadAuthConfig, type AuthConfig } from "./config.js";
import {
  createWorkOSProvider,
  createPropelAuthProvider,
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
      createWorkOSProvider(resolvedConfig.oauth, resolvedConfig.convexUrl) ??
      createPropelAuthProvider(resolvedConfig.oauth, resolvedConfig.convexUrl) ??
      createAuth0Provider(resolvedConfig.oauth, resolvedConfig.convexUrl) ??
      createCustomProvider(resolvedConfig.oauth, resolvedConfig.convexUrl);

    if (oauthProvider) {
      providers.push(oauthProvider);
    }
  }

  if (providers.length === 0) {
    throw new Error(
      "No OAuth provider configured. Set MCP_AUTH_PROVIDER environment variable."
    );
  }

  return new AuthManager({ providers });
}
