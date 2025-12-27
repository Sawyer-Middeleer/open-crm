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
}

/**
 * OAuth 2.1 authentication provider
 * Validates JWT tokens using JWKS
 */
export class OAuthStrategy implements AuthProvider {
  readonly name: string;
  readonly priority = 20; // After API key

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
      return null; // No Bearer token, let other providers try
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
        this.name
      );
    }

    // Check expiration
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      throw new AuthError("Token has expired", 401, this.name);
    }

    // Get or create user
    const userId = await this.getOrCreateUser(claims);

    // Get workspace from header
    const workspaceIdStr = request.headers["x-workspace-id"];
    if (!workspaceIdStr) {
      throw new AuthError(
        "X-Workspace-Id header required",
        400,
        this.name
      );
    }

    // Get workspace member
    const member = await this.convex.query(
      api.functions.auth.queries.getMemberByUserAndWorkspace,
      {
        userId: userId,
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
      userId,
      email: claims.email,
      workspaceId: workspaceIdStr as Id<"workspaces">,
      workspaceMemberId: member._id,
      role: member.role,
      authMethod: "oauth",
      provider: this.config.providerName,
    };
  }

  private async getOrCreateUser(claims: TokenClaims): Promise<Id<"users">> {
    if (!claims.email) {
      throw new AuthError("Token missing email claim", 401, this.name);
    }

    // Upsert user
    const userId = await this.convex.mutation(
      api.functions.auth.mutations.upsertFromOAuth,
      {
        authProvider: this.config.providerName,
        authProviderId: claims.sub,
        email: claims.email,
        name: (claims.name as string) ?? undefined,
      }
    );

    return userId;
  }
}
