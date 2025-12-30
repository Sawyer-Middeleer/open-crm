import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import {
  seedSystemObjectTypes,
  generateWorkspaceSlug,
  generateWorkspaceName,
} from "../../lib/seedWorkspace";
import { createAuditLog } from "../../lib/audit";

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
 * Upsert user from OAuth provider with automatic workspace creation
 * Creates new user or updates existing one, and optionally creates a default workspace
 * if the user has no workspace memberships.
 */
export const upsertFromOAuthWithWorkspace = mutation({
  args: {
    authProvider: v.string(),
    authProviderId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    autoCreateWorkspace: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const autoCreate = args.autoCreateWorkspace !== false; // Default to true

    // Check if user exists by auth provider
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_auth_provider", (q) =>
        q
          .eq("authProvider", args.authProvider)
          .eq("authProviderId", args.authProviderId)
      )
      .first();

    let userId: string;
    let isNewUser = false;

    if (existingUser) {
      // Update last login and return
      await ctx.db.patch(existingUser._id, {
        lastLoginAt: now,
        updatedAt: now,
        email: args.email,
        name: args.name ?? existingUser.name,
      });
      userId = existingUser._id;
    } else {
      // Check if user exists by email (might be from different provider)
      const existingByEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first();

      if (existingByEmail) {
        throw new Error(
          `Email ${args.email} is already associated with another account`
        );
      }

      // Create new user
      userId = await ctx.db.insert("users", {
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
      isNewUser = true;
    }

    // Check if user has any workspace memberships
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .collect();

    // If user has workspaces, return without creating a new one
    if (memberships.length > 0) {
      return {
        userId,
        isNewUser,
        isNewWorkspace: false,
      };
    }

    // User has no workspaces - auto-create if enabled
    if (!autoCreate) {
      return {
        userId,
        isNewUser,
        isNewWorkspace: false,
      };
    }

    // Generate workspace name and slug
    const workspaceName = generateWorkspaceName(args.name, args.email);
    const workspaceSlug = generateWorkspaceSlug(args.email);

    // Create workspace
    const workspaceId = await ctx.db.insert("workspaces", {
      name: workspaceName,
      slug: workspaceSlug,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

    // Handle potential slug collision (same as workspaces.create)
    const duplicates = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", workspaceSlug))
      .collect();

    if (duplicates.length > 1) {
      const sorted = duplicates.sort(
        (a, b) => a._creationTime - b._creationTime
      );
      const winner = sorted[0];

      if (winner._id !== workspaceId) {
        // We lost the race - delete our record and retry with new slug
        await ctx.db.delete(workspaceId);
        // For simplicity, throw an error - extremely rare edge case
        throw new Error(
          "Workspace slug collision occurred. Please retry authentication."
        );
      }
      // We won - clean up any duplicates
      for (const dup of sorted.slice(1)) {
        await ctx.db.delete(dup._id);
      }
    }

    // Create owner membership
    const memberId = await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: userId as any,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });

    // Seed system object types
    await seedSystemObjectTypes(ctx, workspaceId);

    // Create audit log
    await createAuditLog(ctx, {
      workspaceId,
      entityType: "workspace",
      entityId: workspaceId,
      action: "create",
      changes: [
        { field: "name", after: workspaceName },
        { field: "slug", after: workspaceSlug },
        { field: "auto_created", after: "true" },
      ],
      actorId: memberId,
      actorType: "user",
    });

    // Update user's default workspace preference
    await ctx.db.patch(userId as any, {
      preferences: {
        defaultWorkspaceId: workspaceId,
      },
      updatedAt: now,
    });

    return {
      userId,
      workspaceId,
      workspaceMemberId: memberId,
      isNewUser,
      isNewWorkspace: true,
    };
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
