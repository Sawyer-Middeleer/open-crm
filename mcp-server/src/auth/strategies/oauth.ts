import { ConvexHttpClient } from "convex/browser";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { api } from "../../../../convex/_generated/api.js";
import type {
  AuthProvider,
  AuthContext,
  AuthRequest,
  TokenClaims,
} from "../types.js";
import { AuthError } from "../errors.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";

export interface OAuthStrategyConfig {
  providerName: string;
  issuer: string;
  jwksUri: string;
  audience?: string;
  convexUrl: string;
  autoCreateWorkspace?: boolean;
}

/**
 * OAuth 2.1 authentication provider
 * Validates JWT tokens using JWKS
 *
 * Supports:
 * - Interactive users: workspace from X-Workspace-Id header
 * - M2M clients: workspace from token claim (workspace_id, org_id, or custom)
 * - Scopes from token (space-separated per RFC 8693 or array)
 */
export class OAuthStrategy implements AuthProvider {
  readonly name: string;
  readonly priority = 10; // Primary auth provider

  private config: OAuthStrategyConfig;
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private convex: ConvexHttpClient;

  constructor(config: OAuthStrategyConfig) {
    this.name = `oauth-${config.providerName}`;
    this.config = config;
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
    this.convex = new ConvexHttpClient(config.convexUrl);
  }

  async authenticate(request: AuthRequest): Promise<AuthContext | null> {
    // Extract Bearer token
    const authHeader = request.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      return null; // No Bearer token
    }

    const token = authHeader.slice(7);

    // Validate JWT
    let claims: TokenClaims;
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      claims = payload as TokenClaims;
    } catch (error) {
      throw new AuthError(
        `Invalid token: ${error instanceof Error ? error.message : "verification failed"}`,
        401,
        this.name,
        "invalid_token"
      );
    }

    // Check expiration (jose already does this, but belt and suspenders)
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      throw new AuthError("Token has expired", 401, this.name, "invalid_token");
    }

    // Get or create user (may auto-create workspace)
    const userResult = await this.getOrCreateUser(claims);

    // Extract scopes from JWT (space-separated per RFC 8693 or array)
    const scopes = this.extractScopes(claims);

    // If workspace was auto-created, use it directly
    if (userResult.workspaceId && userResult.workspaceMemberId) {
      return {
        userId: userResult.userId,
        email: claims.email,
        workspaceId: userResult.workspaceId as Id<"workspaces">,
        workspaceMemberId: userResult.workspaceMemberId as Id<"workspaceMembers">,
        role: "owner", // Auto-created workspaces make user the owner
        authMethod: "oauth",
        provider: this.config.providerName,
        scopes,
      };
    }

    // Get workspace ID from token claim (M2M) or header (interactive)
    const workspaceIdStr = this.extractWorkspaceId(claims, request);

    // Get workspace member
    const member = await this.convex.query(
      api.functions.auth.queries.getMemberByUserAndWorkspace,
      {
        userId: userResult.userId,
        workspaceId: workspaceIdStr as Id<"workspaces">,
      }
    );

    if (!member) {
      throw new AuthError(
        "User is not a member of this workspace",
        403,
        this.name
      );
    }

    return {
      userId: userResult.userId,
      email: claims.email,
      workspaceId: workspaceIdStr as Id<"workspaces">,
      workspaceMemberId: member._id,
      role: member.role,
      authMethod: "oauth",
      provider: this.config.providerName,
      scopes,
    };
  }

  /**
   * Extract workspace ID from token claims or request header
   * Priority: token claim > header
   *
   * Common claim names by provider:
   * - PropelAuth: org_id
   * - Auth0/custom: workspace_id or https://agent-crm/workspace_id
   */
  private extractWorkspaceId(
    claims: TokenClaims,
    request: AuthRequest
  ): string {
    // Try token claims first (M2M flow)
    const claimWorkspaceId =
      (claims.workspace_id as string) ??
      (claims.org_id as string) ?? // PropelAuth uses org_id
      (claims["https://agent-crm/workspace_id"] as string);

    if (claimWorkspaceId) {
      return claimWorkspaceId;
    }

    // Fall back to header (interactive flow)
    const headerWorkspaceId = request.headers["x-workspace-id"];
    if (headerWorkspaceId) {
      return headerWorkspaceId;
    }

    throw new AuthError(
      "Workspace ID required: include workspace_id claim in token or X-Workspace-Id header",
      400,
      this.name
    );
  }

  /**
   * Extract scopes from JWT claims
   * Handles both space-separated string (RFC 8693) and array formats
   */
  private extractScopes(claims: TokenClaims): string[] {
    // Space-separated string (OAuth 2.0 / RFC 8693)
    if (typeof claims.scope === "string") {
      return claims.scope.split(" ").filter(Boolean);
    }

    // Array format (some providers use this)
    if (Array.isArray(claims.scp)) {
      return claims.scp;
    }

    // No scopes in token
    return [];
  }

  private async getOrCreateUser(claims: TokenClaims): Promise<{
    userId: Id<"users">;
    workspaceId?: string;
    workspaceMemberId?: string;
    isNewUser: boolean;
    isNewWorkspace: boolean;
  }> {
    if (!claims.email) {
      throw new AuthError(
        "Token missing email claim",
        401,
        this.name,
        "invalid_token"
      );
    }

    // Upsert user with optional workspace auto-creation
    const result = await this.convex.mutation(
      api.functions.auth.mutations.upsertFromOAuthWithWorkspace,
      {
        authProvider: this.config.providerName,
        authProviderId: claims.sub,
        email: claims.email,
        name: (claims.name as string) ?? undefined,
        autoCreateWorkspace: this.config.autoCreateWorkspace,
      }
    );

    return {
      userId: result.userId as Id<"users">,
      workspaceId: result.workspaceId,
      workspaceMemberId: result.workspaceMemberId,
      isNewUser: result.isNewUser,
      isNewWorkspace: result.isNewWorkspace,
    };
  }
}
