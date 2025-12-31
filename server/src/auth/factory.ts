import { AuthManager } from "./manager.js";
import { loadAuthConfig, type AuthConfig } from "./config.js";
import {
  createAuth0Provider,
  createCustomProvider,
} from "./providers/index.js";
import { ApiKeyStrategy } from "./strategies/apikey.js";
import type { AuthProvider } from "./types.js";

/**
 * Create AuthManager with auth providers based on configuration
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

  // Add API Key provider if enabled
  if (resolvedConfig.apiKey?.enabled) {
    providers.push(
      new ApiKeyStrategy({ convexUrl: resolvedConfig.convexUrl })
    );
  }

  if (providers.length === 0) {
    throw new Error(
      "No auth provider configured. Set MCP_AUTH_PROVIDER environment variable or enable API key auth."
    );
  }

  return new AuthManager({ providers });
}
