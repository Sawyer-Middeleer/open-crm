import type { Id } from "../../../convex/_generated/dataModel.js";

/**
 * Authenticated context passed to tool handlers
 */
export interface AuthContext {
  // User identity
  userId: Id<"users">;
  email?: string;

  // Workspace context (from X-Workspace-Id header)
  workspaceId: Id<"workspaces">;
  workspaceMemberId: Id<"workspaceMembers">;
  role: "owner" | "admin" | "member" | "viewer";

  // Auth metadata
  authMethod: "oauth" | "api-key";
  provider?: string;
  scopes?: string[];
}

/**
 * Request context passed to auth providers
 */
export interface AuthRequest {
  headers: Record<string, string | undefined>;
}

/**
 * Authentication provider interface
 * Pattern: Takes request info, returns context or null
 */
export interface AuthProvider {
  /** Unique identifier for this provider */
  readonly name: string;

  /** Priority order (lower = checked first) */
  readonly priority: number;

  /**
   * Attempt to authenticate the request
   * @returns AuthContext if successful, null if this provider doesn't apply
   * @throws AuthError if auth was attempted but failed
   */
  authenticate(request: AuthRequest): Promise<AuthContext | null>;
}

/**
 * OAuth token claims from JWT
 */
export interface TokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  iss: string;
  aud?: string | string[];
  exp: number;
  iat: number;
  [key: string]: unknown;
}

/**
 * OAuth provider interface for JWT validation
 */
export interface OAuthProviderConfig {
  name: string;
  issuer: string;
  jwksUri?: string;
  audience?: string;
}
