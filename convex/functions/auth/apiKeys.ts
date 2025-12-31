import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";

/**
 * Get API key by hash (for authentication)
 * Returns the key with user and workspace info
 */
export const getByKeyHash = query({
  args: {
    keyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .first();

    if (!apiKey) {
      return null;
    }

    // Get the user
    const user = await ctx.db.get(apiKey.userId);
    if (!user || user.status !== "active") {
      return null;
    }

    // Get workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", apiKey.workspaceId).eq("userId", apiKey.userId)
      )
      .first();

    if (!membership) {
      return null;
    }

    return {
      apiKey,
      user,
      membership,
    };
  },
});

/**
 * List API keys for a user in a workspace
 */
export const listByUserAndWorkspace = query({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user_workspace", (q) =>
        q.eq("userId", args.userId).eq("workspaceId", args.workspaceId)
      )
      .collect();

    // Return keys without the hash (security)
    return keys.map((key) => ({
      _id: key._id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      isRevoked: key.isRevoked,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
    }));
  },
});

/**
 * Create a new API key
 * Returns the key info (hash stored, prefix for display)
 */
export const create = mutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    name: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify user exists and is active
    const user = await ctx.db.get(args.userId);
    if (!user || user.status !== "active") {
      throw new Error("User not found or inactive");
    }

    // Verify workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId)
      )
      .first();

    if (!membership) {
      throw new Error("User is not a member of this workspace");
    }

    // Only owners and admins can create API keys
    if (!["owner", "admin"].includes(membership.role)) {
      throw new Error("Only owners and admins can create API keys");
    }

    // Check for duplicate key hash (extremely unlikely with proper entropy)
    const existingKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .first();

    if (existingKey) {
      throw new Error("Key collision detected. Please retry.");
    }

    const now = Date.now();

    const keyId = await ctx.db.insert("apiKeys", {
      userId: args.userId,
      workspaceId: args.workspaceId,
      name: args.name,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      scopes: args.scopes,
      isRevoked: false,
      expiresAt: args.expiresAt,
      createdAt: now,
    });

    return {
      _id: keyId,
      keyPrefix: args.keyPrefix,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt: now,
    };
  },
});

/**
 * Revoke an API key
 */
export const revoke = mutation({
  args: {
    keyId: v.id("apiKeys"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    // Verify actor has permission
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", apiKey.workspaceId).eq("userId", args.actorUserId)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this workspace");
    }

    // Only owners, admins, or the key creator can revoke
    const isOwnerOrAdmin = ["owner", "admin"].includes(membership.role);
    const isCreator = apiKey.userId === args.actorUserId;

    if (!isOwnerOrAdmin && !isCreator) {
      throw new Error("Not authorized to revoke this key");
    }

    await ctx.db.patch(args.keyId, {
      isRevoked: true,
    });

    return { success: true };
  },
});

/**
 * Update last used timestamp for an API key
 */
export const updateLastUsed = mutation({
  args: {
    keyId: v.id("apiKeys"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, {
      lastUsedAt: Date.now(),
    });
  },
});

/**
 * Delete an API key permanently
 */
export const deleteKey = mutation({
  args: {
    keyId: v.id("apiKeys"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    if (!apiKey) {
      throw new Error("API key not found");
    }

    // Verify actor has permission
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", apiKey.workspaceId).eq("userId", args.actorUserId)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this workspace");
    }

    // Only owners can permanently delete keys
    if (membership.role !== "owner") {
      throw new Error("Only workspace owners can permanently delete API keys");
    }

    await ctx.db.delete(args.keyId);

    return { success: true };
  },
});
