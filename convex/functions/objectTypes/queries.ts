import { query } from "../../_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const objectTypes = await ctx.db
      .query("objectTypes")
      .withIndex("by_workspace_active", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("isActive", true)
      )
      .collect();

    return objectTypes.map((ot) => ({
      id: ot._id,
      name: ot.name,
      slug: ot.slug,
      singularName: ot.singularName,
      description: ot.description,
      icon: ot.icon,
      isSystem: ot.isSystem,
    }));
  },
});

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const objectType = await ctx.db
      .query("objectTypes")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    return objectType;
  },
});

export const getWithAttributes = query({
  args: {
    workspaceId: v.id("workspaces"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const objectType = await ctx.db
      .query("objectTypes")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    if (!objectType) {
      return null;
    }

    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", objectType._id))
      .collect();

    // Sort by sortOrder
    attributes.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      ...objectType,
      attributes: attributes.map((attr) => ({
        id: attr._id,
        name: attr.name,
        slug: attr.slug,
        type: attr.type,
        isSystem: attr.isSystem,
        isRequired: attr.isRequired,
        isUnique: attr.isUnique,
        isSearchable: attr.isSearchable,
        isFilterable: attr.isFilterable,
        config: attr.config,
        defaultValue: attr.defaultValue,
      })),
    };
  },
});
