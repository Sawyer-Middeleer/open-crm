import { query } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Validate an API key by prefix and hash
 */
export const validateApiKey = query({
  args: {
    keyPrefix: v.string(),
    keyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_prefix", (q) => q.eq("keyPrefix", args.keyPrefix))
      .first();

    if (!apiKey) {
      return null;
    }

    // Verify hash matches
    if (apiKey.keyHash !== args.keyHash) {
      return null;
    }

    // Get the user who created this key
    const user = await ctx.db.get(apiKey.createdBy);
    if (!user) {
      return null;
    }

    return {
      workspaceId: apiKey.workspaceId,
      userId: apiKey.createdBy,
      name: apiKey.name,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      isActive: apiKey.isActive,
    };
  },
});

/**
 * Get workspace member by user ID and workspace ID
 */
export const getMemberByUserAndWorkspace = query({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId)
      )
      .first();

    return member;
  },
});

/**
 * Get user by auth provider credentials
 */
export const getUserByAuthProvider = query({
  args: {
    authProvider: v.string(),
    authProviderId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_provider", (q) =>
        q
          .eq("authProvider", args.authProvider)
          .eq("authProviderId", args.authProviderId)
      )
      .first();

    return user;
  },
});

/**
 * Get user by email
 */
export const getUserByEmail = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    return user;
  },
});

/**
 * Get user by ID
 */
export const getUser = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

/**
 * List API keys for a workspace (without secrets)
 */
export const listApiKeys = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // Return keys without the hash
    return keys.map((key) => ({
      _id: key._id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      isActive: key.isActive,
      createdAt: key.createdAt,
    }));
  },
});

/**
 * List workspaces for a user
 */
export const listUserWorkspaces = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const workspaces = await Promise.all(
      memberships.map(async (membership) => {
        const workspace = await ctx.db.get(membership.workspaceId);
        return {
          ...workspace,
          role: membership.role,
          memberId: membership._id,
        };
      })
    );

    return workspaces.filter((w) => w !== null);
  },
});
