import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import {
  seedSystemObjectTypes,
  generateWorkspaceSlug,
  generateWorkspaceName,
} from "../../lib/seedWorkspace";
import { createAuditLog } from "../../lib/audit";

/**
 * Check if setup has already been run for an email
 */
export const getSetupStatus = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if user exists by email
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!user) {
      return { exists: false };
    }

    // Get user's workspace memberships
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Get workspace details for each membership
    const workspaces = await Promise.all(
      memberships.map(async (m) => {
        const workspace = await ctx.db.get(m.workspaceId);
        return workspace
          ? {
              _id: workspace._id,
              name: workspace.name,
              slug: workspace.slug,
              role: m.role,
            }
          : null;
      })
    );

    return {
      exists: true,
      userId: user._id,
      email: user.email,
      name: user.name,
      workspaces: workspaces.filter(Boolean),
    };
  },
});

/**
 * Bootstrap a new admin user with workspace and API key
 * This is an atomic operation for first-time setup via CLI
 *
 * Called by: `bun run setup` CLI command
 */
export const bootstrap = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
    keyHash: v.string(),
    keyPrefix: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if user already exists by email
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      throw new Error(
        `User with email ${args.email} already exists. Use 'bun run setup:workspace' to create additional workspaces.`
      );
    }

    // 1. Create user
    const userId = await ctx.db.insert("users", {
      authProvider: "cli-setup",
      authProviderId: `cli_${args.email}`,
      email: args.email,
      name: args.name,
      preferences: {},
      status: "active",
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Create workspace
    const workspaceName =
      args.workspaceName || generateWorkspaceName(args.name, args.email);
    const workspaceSlug = generateWorkspaceSlug(args.email);

    const workspaceId = await ctx.db.insert("workspaces", {
      name: workspaceName,
      slug: workspaceSlug,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

    // Handle potential slug collision
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
        // Clean up and throw - rare edge case
        await ctx.db.delete(workspaceId);
        await ctx.db.delete(userId);
        throw new Error(
          "Workspace slug collision occurred. Please retry setup."
        );
      }
      // Clean up duplicates
      for (const dup of sorted.slice(1)) {
        await ctx.db.delete(dup._id);
      }
    }

    // 3. Create owner membership
    const memberId = await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });

    // 4. Seed system object types (People, Companies, Deals)
    await seedSystemObjectTypes(ctx, workspaceId);

    // 5. Create API key with full admin access
    const keyId = await ctx.db.insert("apiKeys", {
      userId,
      workspaceId,
      name: "CLI Setup Key",
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      scopes: ["crm:admin"],
      isRevoked: false,
      createdAt: now,
    });

    // 6. Update user's default workspace preference
    await ctx.db.patch(userId, {
      preferences: {
        defaultWorkspaceId: workspaceId,
      },
      updatedAt: now,
    });

    // 7. Create audit log
    await createAuditLog(ctx, {
      workspaceId,
      entityType: "workspace",
      entityId: workspaceId,
      action: "create",
      changes: [
        { field: "name", after: workspaceName },
        { field: "slug", after: workspaceSlug },
        { field: "setup_method", after: "cli-bootstrap" },
      ],
      actorId: memberId,
      actorType: "user",
    });

    return {
      userId,
      workspaceId,
      workspaceMemberId: memberId,
      apiKeyId: keyId,
      workspaceSlug,
    };
  },
});

/**
 * Create an additional workspace for an existing user
 */
export const createWorkspaceForUser = mutation({
  args: {
    email: v.string(),
    workspaceName: v.optional(v.string()),
    keyHash: v.string(),
    keyPrefix: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find user by email
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!user) {
      throw new Error(`User with email ${args.email} not found. Run 'bun run setup' first.`);
    }

    // Generate workspace name and slug
    const workspaceName = args.workspaceName || `${user.name || args.email.split("@")[0]}'s Workspace`;
    const workspaceSlug = generateWorkspaceSlug(args.email);

    // Create workspace
    const workspaceId = await ctx.db.insert("workspaces", {
      name: workspaceName,
      slug: workspaceSlug,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

    // Create owner membership
    const memberId = await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: user._id,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });

    // Seed system object types
    await seedSystemObjectTypes(ctx, workspaceId);

    // Create API key for this workspace
    const keyId = await ctx.db.insert("apiKeys", {
      userId: user._id,
      workspaceId,
      name: "CLI Setup Key",
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      scopes: ["crm:admin"],
      isRevoked: false,
      createdAt: now,
    });

    // Create audit log
    await createAuditLog(ctx, {
      workspaceId,
      entityType: "workspace",
      entityId: workspaceId,
      action: "create",
      changes: [
        { field: "name", after: workspaceName },
        { field: "slug", after: workspaceSlug },
        { field: "setup_method", after: "cli-add-workspace" },
      ],
      actorId: memberId,
      actorType: "user",
    });

    return {
      userId: user._id,
      workspaceId,
      workspaceMemberId: memberId,
      apiKeyId: keyId,
      workspaceSlug,
    };
  },
});
