import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api.js";
import type { AuthProvider, AuthContext, AuthRequest } from "../types.js";
import { AuthError } from "../errors.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";

const API_KEY_HEADER = "x-api-key";

/**
 * API Key authentication provider
 * Key format: crm_<prefix>_<secret>
 */
export class ApiKeyProvider implements AuthProvider {
  readonly name = "api-key";
  readonly priority = 10; // Check first

  private convex: ConvexHttpClient;

  constructor(convexUrl: string) {
    this.convex = new ConvexHttpClient(convexUrl);
  }

  async authenticate(request: AuthRequest): Promise<AuthContext | null> {
    // Extract API key from header
    const apiKey = request.headers[API_KEY_HEADER];
    if (!apiKey) {
      return null; // No API key, let other providers try
    }

    // Parse key: crm_<prefix>_<secret>
    const parts = apiKey.split("_");
    if (parts.length !== 3 || parts[0] !== "crm") {
      throw new AuthError("Invalid API key format", 401, this.name);
    }

    const keyPrefix = `crm_${parts[1]}`;
    const secret = parts[2];

    // Hash the secret
    const keyHash = await this.hashSecret(secret);

    // Validate against Convex
    const result = await this.convex.query(
      api.functions.auth.queries.validateApiKey,
      { keyPrefix, keyHash }
    );

    if (!result) {
      throw new AuthError("Invalid API key", 401, this.name);
    }

    if (!result.isActive) {
      throw new AuthError("API key is inactive", 401, this.name);
    }

    if (result.expiresAt && result.expiresAt < Date.now()) {
      throw new AuthError("API key has expired", 401, this.name);
    }

    // Get workspace from header
    const workspaceIdStr = request.headers["x-workspace-id"];
    if (!workspaceIdStr) {
      throw new AuthError(
        "X-Workspace-Id header required for API key auth",
        400,
        this.name
      );
    }

    // Verify key belongs to this workspace
    if (result.workspaceId !== workspaceIdStr) {
      throw new AuthError(
        "API key not valid for this workspace",
        403,
        this.name
      );
    }

    // Get workspace member for the key's user
    const member = await this.convex.query(
      api.functions.auth.queries.getMemberByUserAndWorkspace,
      {
        userId: result.userId as Id<"users">,
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

    // Update last used timestamp (fire and forget, but log errors)
    this.convex
      .mutation(api.functions.auth.mutations.updateApiKeyLastUsed, {
        keyPrefix,
      })
      .catch((error) => {
        console.error("[Auth] Failed to update API key lastUsedAt:", error);
      });

    return {
      userId: result.userId as Id<"users">,
      workspaceId: workspaceIdStr as Id<"workspaces">,
      workspaceMemberId: member._id,
      role: member.role,
      authMethod: "api-key",
      scopes: result.scopes,
    };
  }

  private async hashSecret(secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(secret);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
