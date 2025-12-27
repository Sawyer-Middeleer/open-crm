import type { AuthProvider, AuthContext, AuthRequest } from "./types.js";
import { AuthError } from "./errors.js";
import { isNetworkError } from "../lib/validation.js";

export interface AuthManagerConfig {
  providers: AuthProvider[];
}

/**
 * AuthManager orchestrates authentication across multiple providers
 * Tries each provider in priority order until one succeeds
 */
export class AuthManager {
  private providers: AuthProvider[];

  constructor(config: AuthManagerConfig) {
    // Sort by priority (lower = first)
    this.providers = [...config.providers].sort(
      (a, b) => a.priority - b.priority
    );
  }

  /**
   * Authenticate a request by trying providers in order
   * @throws AuthError if authentication fails
   */
  async authenticate(request: AuthRequest): Promise<AuthContext> {
    for (const provider of this.providers) {
      try {
        const context = await provider.authenticate(request);
        if (context) {
          return context;
        }
      } catch (error) {
        // Explicit auth failure - stop fallback
        if (error instanceof AuthError) {
          throw error;
        }
        // Network error - provider unavailable, try next
        if (isNetworkError(error)) {
          console.warn(
            `[Auth] Provider ${provider.name} unavailable: ${error instanceof Error ? error.message : String(error)}`
          );
          continue;
        }
        // Unknown error - wrap and throw
        throw new AuthError(
          `Authentication failed via ${provider.name}: ${error instanceof Error ? error.message : String(error)}`,
          401,
          provider.name
        );
      }
    }

    // No provider succeeded
    throw new AuthError("No valid authentication provided", 401);
  }
}
