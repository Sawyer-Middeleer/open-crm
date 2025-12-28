import { query } from "../../_generated/server";
import { v } from "convex/values";

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
