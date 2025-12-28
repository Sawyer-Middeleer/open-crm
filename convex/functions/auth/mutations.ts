import { mutation } from "../../_generated/server";
import { v } from "convex/values";

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
