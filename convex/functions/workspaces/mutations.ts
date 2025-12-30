import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog } from "../../lib/audit";
import { seedSystemObjectTypes } from "../../lib/seedWorkspace";
import { assertActorInWorkspace } from "../../lib/auth";

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

// ============================================================================
// MEMBER MANAGEMENT
// ============================================================================

const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer")
);

export const updateMember = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    memberId: v.id("workspaceMembers"),
    role: roleValidator,
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Get actor's role
    const actor = await ctx.db.get(args.actorId);
    if (!actor || actor.workspaceId !== args.workspaceId) {
      throw new Error("Actor not found in workspace");
    }

    // Only owners and admins can update members
    if (actor.role !== "owner" && actor.role !== "admin") {
      throw new Error("Only owners and admins can update member roles");
    }

    // Get target member
    const targetMember = await ctx.db.get(args.memberId);
    if (!targetMember || targetMember.workspaceId !== args.workspaceId) {
      throw new Error("Member not found");
    }

    // Only owners can promote to owner
    if (args.role === "owner" && actor.role !== "owner") {
      throw new Error("Only owners can promote members to owner");
    }

    // Only owners can demote owners
    if (targetMember.role === "owner" && actor.role !== "owner") {
      throw new Error("Only owners can change another owner's role");
    }

    // Block demoting the last owner
    if (targetMember.role === "owner" && args.role !== "owner") {
      const owners = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .filter((q) => q.eq(q.field("role"), "owner"))
        .collect();

      if (owners.length <= 1) {
        throw new Error("Cannot demote the last owner. Transfer ownership first.");
      }
    }

    const oldRole = targetMember.role;
    const now = Date.now();

    await ctx.db.patch(args.memberId, {
      role: args.role,
      updatedAt: now,
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "workspaceMember",
      entityId: args.memberId,
      action: "update",
      changes: [{ field: "role", before: oldRole, after: args.role }],
      actorId: args.actorId,
      actorType: "user",
    });

    const member = await ctx.db.get(args.memberId);

    return { memberId: args.memberId, member };
  },
});

export const removeMember = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    memberId: v.id("workspaceMembers"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Get actor's role
    const actor = await ctx.db.get(args.actorId);
    if (!actor || actor.workspaceId !== args.workspaceId) {
      throw new Error("Actor not found in workspace");
    }

    // Only owners and admins can remove members
    if (actor.role !== "owner" && actor.role !== "admin") {
      throw new Error("Only owners and admins can remove members");
    }

    // Get target member
    const targetMember = await ctx.db.get(args.memberId);
    if (!targetMember || targetMember.workspaceId !== args.workspaceId) {
      throw new Error("Member not found");
    }

    // Admins cannot remove owners
    if (targetMember.role === "owner" && actor.role !== "owner") {
      throw new Error("Admins cannot remove owners");
    }

    // Block removing the last owner
    if (targetMember.role === "owner") {
      const owners = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .filter((q) => q.eq(q.field("role"), "owner"))
        .collect();

      if (owners.length <= 1) {
        throw new Error("Cannot remove the last owner. Transfer ownership first.");
      }
    }

    // Cannot remove yourself (prevents accidental lockout)
    if (args.memberId === args.actorId) {
      throw new Error("Cannot remove yourself from the workspace");
    }

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "workspaceMember",
      entityId: args.memberId,
      action: "delete",
      changes: [{ field: "role", before: targetMember.role, after: null }],
      beforeSnapshot: { userId: targetMember.userId, role: targetMember.role },
      actorId: args.actorId,
      actorType: "user",
    });

    await ctx.db.delete(args.memberId);

    return { success: true };
  },
});
