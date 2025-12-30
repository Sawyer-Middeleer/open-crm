import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog } from "../../lib/audit";
import { seedSystemObjectTypes } from "../../lib/seedWorkspace";

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    userId: v.id("users"), // User ID from users table
  },
  handler: async (ctx, args) => {
    // Verify user exists
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();

    // Insert first, then check for duplicates (prevents TOCTOU race condition)
    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name,
      slug: args.slug,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });

    // Check for duplicate slugs after insert
    const duplicates = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .collect();

    if (duplicates.length > 1) {
      // Keep the earliest by _creationTime, delete others
      const sorted = duplicates.sort((a, b) => a._creationTime - b._creationTime);
      const winner = sorted[0];

      if (winner._id !== workspaceId) {
        // We lost the race - delete our record and throw
        await ctx.db.delete(workspaceId);
        throw new Error(`Workspace with slug '${args.slug}' already exists`);
      }
      // We won - clean up any duplicates (shouldn't normally happen)
      for (const dup of sorted.slice(1)) {
        await ctx.db.delete(dup._id);
      }
    }

    // Create owner member
    const memberId = await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: args.userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });

    // Seed system object types
    await seedSystemObjectTypes(ctx, workspaceId);

    await createAuditLog(ctx, {
      workspaceId,
      entityType: "workspace",
      entityId: workspaceId,
      action: "create",
      changes: [
        { field: "name", after: args.name },
        { field: "slug", after: args.slug },
      ],
      actorId: memberId,
      actorType: "user",
    });

    const workspace = await ctx.db.get(workspaceId);

    return { workspaceId, workspace, memberId };
  },
});

export const addMember = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("member"),
      v.literal("viewer")
    ),
  },
  handler: async (ctx, args) => {
    // Verify user exists
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Check if already a member
    const existing = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId)
      )
      .first();

    if (existing) {
      throw new Error("User is already a member of this workspace");
    }

    const now = Date.now();

    const memberId = await ctx.db.insert("workspaceMembers", {
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: args.role,
      createdAt: now,
      updatedAt: now,
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "workspaceMember",
      entityId: memberId,
      action: "create",
      changes: [
        { field: "userId", after: args.userId },
        { field: "role", after: args.role },
      ],
      actorId: memberId,
      actorType: "user",
    });

    const member = await ctx.db.get(memberId);

    return { memberId, member };
  },
});
