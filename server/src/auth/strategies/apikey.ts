import { ConvexHttpClient } from "convex/browser";
import { createHash } from "crypto";
import { api } from "../../../../convex/_generated/api.js";
import type { AuthProvider, AuthContext, AuthRequest } from "../types.js";
import { AuthError } from "../errors.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";

export interface ApiKeyStrategyConfig {
  convexUrl: string;
}

/**
 * API Key authentication provider
 * Validates API keys from X-API-Key header
 *
 * Key format: ocrm_live_<random>
 * Storage: SHA-256 hash stored in database
 */
export class ApiKeyStrategy implements AuthProvider {
  readonly name = "api-key";
  readonly priority = 20; // After OAuth (10)

  private convex: ConvexHttpClient;

  constructor(config: ApiKeyStrategyConfig) {
    this.convex = new ConvexHttpClient(config.convexUrl);
  }

  async authenticate(request: AuthRequest): Promise<AuthContext | null> {
    // Extract API key from header
    const apiKey = request.headers["x-api-key"];
    if (!apiKey) {
      return null; // No API key header, let other providers try
    }

    // Validate key format
    if (!this.isValidKeyFormat(apiKey)) {
      throw new AuthError(
        "Invalid API key format",
        401,
        this.name,
        "invalid_token"
      );
    }

    // Hash the key for lookup
    const keyHash = this.hashKey(apiKey);

    // Look up the key in the database
    const result = await this.convex.query(
      api.functions.auth.apiKeys.getByKeyHash,
      { keyHash }
    );

    if (!result) {
      throw new AuthError(
        "Invalid API key",
        401,
        this.name,
        "invalid_token"
      );
    }

    const { apiKey: keyRecord, user, membership } = result;

    // Check if key is revoked
    if (keyRecord.isRevoked) {
      throw new AuthError(
        "API key has been revoked",
        401,
        this.name,
        "invalid_token"
      );
    }

    // Check expiration
    if (keyRecord.expiresAt && keyRecord.expiresAt < Date.now()) {
      throw new AuthError(
        "API key has expired",
        401,
        this.name,
        "invalid_token"
      );
    }

    // Update last used timestamp (fire and forget)
    this.convex
      .mutation(api.functions.auth.apiKeys.updateLastUsed, {
        keyId: keyRecord._id,
      })
      .catch(() => {
        // Ignore errors updating last used - not critical
      });

    return {
      userId: user._id as Id<"users">,
      email: user.email,
      workspaceId: keyRecord.workspaceId as Id<"workspaces">,
      workspaceMemberId: membership._id as Id<"workspaceMembers">,
      role: membership.role,
      authMethod: "api-key",
      scopes: keyRecord.scopes,
      apiKeyId: keyRecord._id as Id<"apiKeys">,
    };
  }

  /**
   * Validate API key format: ocrm_live_<base62>
   */
  private isValidKeyFormat(key: string): boolean {
    // Expected format: ocrm_live_<32+ chars of base62>
    const pattern = /^ocrm_(live|test)_[a-zA-Z0-9]{32,}$/;
    return pattern.test(key);
  }

  /**
   * Hash API key using SHA-256
   */
  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }
}

/**
 * Generate a new API key
 * Returns both the raw key (to show user once) and hash (to store)
 */
export function generateApiKey(environment: "live" | "test" = "live"): {
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  // Generate 32 bytes of random data
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);

  // Convert to base62 (alphanumeric only for easy copying)
  const base62Chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let randomPart = "";
  for (const byte of randomBytes) {
    randomPart += base62Chars[byte % 62];
  }

  // Construct full key
  const rawKey = `ocrm_${environment}_${randomPart}`;

  // Hash for storage
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  // First 8 chars for identification (includes prefix)
  const keyPrefix = rawKey.slice(0, 12); // "ocrm_live_XX"

  return { rawKey, keyHash, keyPrefix };
}
