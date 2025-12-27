import { mutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Update API key last used timestamp
 */
export const updateApiKeyLastUsed = mutation({
  args: {
    keyPrefix: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_prefix", (q) => q.eq("keyPrefix", args.keyPrefix))
      .first();

    if (apiKey) {
      await ctx.db.patch(apiKey._id, {
        lastUsedAt: Date.now(),
      });
    }
  },
});

/**
 * Upsert user from OAuth provider
 * Creates new user or updates existing one
 */
export const upsertFromOAuth = mutation({
  args: {
    authProvider: v.string(),
    authProviderId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if user exists by auth provider
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_auth_provider", (q) =>
        q
          .eq("authProvider", args.authProvider)
          .eq("authProviderId", args.authProviderId)
      )
      .first();

    if (existingUser) {
      // Update last login and return
      await ctx.db.patch(existingUser._id, {
        lastLoginAt: now,
        updatedAt: now,
        email: args.email, // Update in case it changed
        name: args.name ?? existingUser.name,
      });
      return existingUser._id;
    }

    // Check if user exists by email (might be from different provider)
    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingByEmail) {
      // Link this auth provider to existing user
      // For now, throw error - user should use existing provider
      throw new Error(
        `Email ${args.email} is already associated with another account`
      );
    }

    // Create new user
    const userId = await ctx.db.insert("users", {
      authProvider: args.authProvider,
      authProviderId: args.authProviderId,
      email: args.email,
      name: args.name,
      preferences: {},
      status: "active",
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return userId;
  },
});

/**
 * Update user's last login timestamp
 */
export const updateLastLogin = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      lastLoginAt: Date.now(),
    });
  },
});

/**
 * Update user preferences
 */
export const updateUserPreferences = mutation({
  args: {
    userId: v.id("users"),
    preferences: v.object({
      defaultWorkspaceId: v.optional(v.id("workspaces")),
      timezone: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(args.userId, {
      preferences: {
        ...user.preferences,
        ...args.preferences,
      },
      updatedAt: Date.now(),
    });

    return await ctx.db.get(args.userId);
  },
});

/**
 * Create a new API key
 * Returns the full key only once - it cannot be retrieved later
 */
export const createApiKey = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    name: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify user is a member of the workspace
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId)
      )
      .first();

    if (!member) {
      throw new Error("User is not a member of this workspace");
    }

    // Only owners and admins can create API keys
    if (member.role !== "owner" && member.role !== "admin") {
      throw new Error("Only owners and admins can create API keys");
    }

    const now = Date.now();

    // Generate key components
    // Format: mcrm_<prefix>_<secret>
    const prefix = generateRandomString(8);
    const secret = generateRandomString(32);
    const fullKey = `mcrm_${prefix}_${secret}`;

    // Hash the secret for storage
    const keyHash = await hashString(secret);

    const keyId = await ctx.db.insert("apiKeys", {
      workspaceId: args.workspaceId,
      name: args.name,
      keyPrefix: prefix,
      keyHash,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      isActive: true,
      createdBy: args.userId,
      createdAt: now,
    });

    return {
      keyId,
      key: fullKey, // Only returned once!
      prefix,
      name: args.name,
    };
  },
});

/**
 * Revoke an API key
 */
export const revokeApiKey = mutation({
  args: {
    keyId: v.id("apiKeys"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key) {
      throw new Error("API key not found");
    }

    // Verify user is a member of the workspace
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", key.workspaceId).eq("userId", args.userId)
      )
      .first();

    if (!member) {
      throw new Error("User is not a member of this workspace");
    }

    // Only owners and admins can revoke API keys
    if (member.role !== "owner" && member.role !== "admin") {
      throw new Error("Only owners and admins can revoke API keys");
    }

    await ctx.db.patch(args.keyId, {
      isActive: false,
    });

    return { success: true };
  },
});

// Helper function to generate random string
function generateRandomString(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper function to hash a string using Web Crypto API
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
