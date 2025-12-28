import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog } from "../../lib/audit";
import { assertActorInWorkspace } from "../../lib/auth";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    singularName: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const now = Date.now();

    // Insert first, then check for duplicates (prevents TOCTOU race condition)
    const objectTypeId = await ctx.db.insert("objectTypes", {
      workspaceId: args.workspaceId,
      name: args.name,
      singularName: args.singularName,
      slug: args.slug,
      description: args.description,
      icon: args.icon,
      isSystem: false,
      isActive: true,
      displayConfig: {},
      createdAt: now,
      updatedAt: now,
    });

    // Check for duplicate slugs after insert
    const duplicates = await ctx.db
      .query("objectTypes")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .collect();

    if (duplicates.length > 1) {
      const sorted = duplicates.sort((a, b) => a._creationTime - b._creationTime);
      const winner = sorted[0];

      if (winner._id !== objectTypeId) {
        await ctx.db.delete(objectTypeId);
        throw new Error(`Object type with slug '${args.slug}' already exists`);
      }
      for (const dup of sorted.slice(1)) {
        await ctx.db.delete(dup._id);
      }
    }

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "objectType",
      entityId: objectTypeId,
      action: "create",
      changes: [
        { field: "name", after: args.name },
        { field: "slug", after: args.slug },
      ],
      actorId: args.actorId,
      actorType: "user",
    });

    const objectType = await ctx.db.get(objectTypeId);

    return { objectTypeId, objectType };
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeId: v.id("objectTypes"),
    name: v.optional(v.string()),
    singularName: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    displayConfig: v.optional(
      v.object({
        primaryAttribute: v.optional(v.string()),
        secondaryAttribute: v.optional(v.string()),
        color: v.optional(v.string()),
      })
    ),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const existing = await ctx.db.get(args.objectTypeId);

    if (!existing || existing.workspaceId !== args.workspaceId) {
      throw new Error("Object type not found");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

    if (args.name !== undefined && args.name !== existing.name) {
      updates.name = args.name;
      changes.push({ field: "name", before: existing.name, after: args.name });
    }

    if (args.singularName !== undefined && args.singularName !== existing.singularName) {
      updates.singularName = args.singularName;
      changes.push({
        field: "singularName",
        before: existing.singularName,
        after: args.singularName,
      });
    }

    if (args.description !== undefined) {
      updates.description = args.description;
      changes.push({
        field: "description",
        before: existing.description,
        after: args.description,
      });
    }

    if (args.icon !== undefined) {
      updates.icon = args.icon;
      changes.push({ field: "icon", before: existing.icon, after: args.icon });
    }

    if (args.displayConfig !== undefined) {
      updates.displayConfig = { ...existing.displayConfig, ...args.displayConfig };
      changes.push({
        field: "displayConfig",
        before: existing.displayConfig,
        after: updates.displayConfig,
      });
    }

    await ctx.db.patch(args.objectTypeId, updates);

    if (changes.length > 0) {
      await createAuditLog(ctx, {
        workspaceId: args.workspaceId,
        entityType: "objectType",
        entityId: args.objectTypeId,
        action: "update",
        changes,
        actorId: args.actorId,
        actorType: "user",
      });
    }

    const objectType = await ctx.db.get(args.objectTypeId);

    return { objectType };
  },
});
