import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog } from "../../lib/audit";

const attributeTypeValidator = v.union(
  v.literal("text"),
  v.literal("richText"),
  v.literal("number"),
  v.literal("currency"),
  v.literal("date"),
  v.literal("datetime"),
  v.literal("boolean"),
  v.literal("select"),
  v.literal("multiSelect"),
  v.literal("email"),
  v.literal("phone"),
  v.literal("url"),
  v.literal("reference"),
  v.literal("user"),
  v.literal("file"),
  v.literal("json")
);

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.string(),
    name: v.string(),
    slug: v.string(),
    type: attributeTypeValidator,
    isRequired: v.boolean(),
    isUnique: v.optional(v.boolean()),
    isSearchable: v.optional(v.boolean()),
    isFilterable: v.optional(v.boolean()),
    defaultValue: v.optional(v.any()),
    config: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Get the object type
    const objectType = await ctx.db
      .query("objectTypes")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.objectTypeSlug)
      )
      .first();

    if (!objectType) {
      throw new Error(`Object type '${args.objectTypeSlug}' not found`);
    }

    // Check for duplicate slug
    const existing = await ctx.db
      .query("attributes")
      .withIndex("by_object_type_slug", (q) =>
        q.eq("objectTypeId", objectType._id).eq("slug", args.slug)
      )
      .first();

    if (existing) {
      throw new Error(
        `Attribute with slug '${args.slug}' already exists on '${args.objectTypeSlug}'`
      );
    }

    // Get max sort order
    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", objectType._id))
      .collect();

    const maxSortOrder = attributes.reduce(
      (max, attr) => Math.max(max, attr.sortOrder),
      0
    );

    const now = Date.now();

    const attributeId = await ctx.db.insert("attributes", {
      workspaceId: args.workspaceId,
      objectTypeId: objectType._id,
      name: args.name,
      slug: args.slug,
      type: args.type,
      isSystem: false,
      isRequired: args.isRequired,
      isUnique: args.isUnique ?? false,
      isSearchable: args.isSearchable ?? false,
      isFilterable: args.isFilterable ?? true,
      sortOrder: maxSortOrder + 1,
      defaultValue: args.defaultValue,
      config: args.config ?? {},
      createdAt: now,
      updatedAt: now,
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "attribute",
      entityId: attributeId,
      objectTypeId: objectType._id,
      action: "create",
      changes: [
        { field: "name", after: args.name },
        { field: "slug", after: args.slug },
        { field: "type", after: args.type },
      ],
      actorId: args.actorId,
      actorType: "user",
    });

    const attribute = await ctx.db.get(attributeId);

    return { attributeId, attribute };
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    attributeId: v.id("attributes"),
    name: v.optional(v.string()),
    isRequired: v.optional(v.boolean()),
    isSearchable: v.optional(v.boolean()),
    isFilterable: v.optional(v.boolean()),
    config: v.optional(v.any()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.attributeId);

    if (!existing || existing.workspaceId !== args.workspaceId) {
      throw new Error("Attribute not found");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

    if (args.name !== undefined && args.name !== existing.name) {
      updates.name = args.name;
      changes.push({ field: "name", before: existing.name, after: args.name });
    }

    if (args.isRequired !== undefined && args.isRequired !== existing.isRequired) {
      updates.isRequired = args.isRequired;
      changes.push({
        field: "isRequired",
        before: existing.isRequired,
        after: args.isRequired,
      });
    }

    if (args.isSearchable !== undefined && args.isSearchable !== existing.isSearchable) {
      updates.isSearchable = args.isSearchable;
      changes.push({
        field: "isSearchable",
        before: existing.isSearchable,
        after: args.isSearchable,
      });
    }

    if (args.isFilterable !== undefined && args.isFilterable !== existing.isFilterable) {
      updates.isFilterable = args.isFilterable;
      changes.push({
        field: "isFilterable",
        before: existing.isFilterable,
        after: args.isFilterable,
      });
    }

    if (args.config !== undefined) {
      updates.config = { ...existing.config, ...args.config };
      changes.push({
        field: "config",
        before: existing.config,
        after: updates.config,
      });
    }

    await ctx.db.patch(args.attributeId, updates);

    if (changes.length > 0) {
      await createAuditLog(ctx, {
        workspaceId: args.workspaceId,
        entityType: "attribute",
        entityId: args.attributeId,
        objectTypeId: existing.objectTypeId,
        action: "update",
        changes,
        actorId: args.actorId,
        actorType: "user",
      });
    }

    const attribute = await ctx.db.get(args.attributeId);

    return { attribute };
  },
});

export const remove = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    attributeId: v.id("attributes"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.attributeId);

    if (!existing || existing.workspaceId !== args.workspaceId) {
      throw new Error("Attribute not found");
    }

    if (existing.isSystem) {
      throw new Error("Cannot delete system attributes");
    }

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "attribute",
      entityId: args.attributeId,
      objectTypeId: existing.objectTypeId,
      action: "delete",
      changes: [],
      beforeSnapshot: existing,
      actorId: args.actorId,
      actorType: "user",
    });

    await ctx.db.delete(args.attributeId);

    return { success: true };
  },
});
