import { query } from "../../_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.recordId);

    if (!record || record.workspaceId !== args.workspaceId) {
      return null;
    }

    // Get the object type
    const objectType = await ctx.db.get(record.objectTypeId);

    return {
      ...record,
      objectType: objectType
        ? {
            name: objectType.name,
            slug: objectType.slug,
            singularName: objectType.singularName,
          }
        : null,
    };
  },
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
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

    const limit = args.limit ?? 50;

    // Query records
    const records = await ctx.db
      .query("records")
      .withIndex("by_workspace_object_type", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("objectTypeId", objectType._id)
      )
      .order("desc")
      .take(limit + 1);

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items,
      hasMore,
      cursor: hasMore ? items[items.length - 1]?._id : undefined,
      objectType: {
        name: objectType.name,
        slug: objectType.slug,
        singularName: objectType.singularName,
      },
    };
  },
});

export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.optional(v.string()),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    let objectTypeId: typeof args.workspaceId | undefined;

    if (args.objectTypeSlug) {
      const objectType = await ctx.db
        .query("objectTypes")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", args.objectTypeSlug!)
        )
        .first();

      if (objectType) {
        objectTypeId = objectType._id as typeof args.workspaceId;
      }
    }

    // For now, simple display name search
    // In production, you'd use Convex search indexes
    let records = await ctx.db
      .query("records")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // Filter by object type if specified
    if (objectTypeId) {
      records = records.filter((r) => r.objectTypeId === objectTypeId);
    }

    // Filter by query (simple displayName match)
    const queryLower = args.query.toLowerCase();
    records = records.filter((r) =>
      r.displayName?.toLowerCase().includes(queryLower)
    );

    return {
      items: records.slice(0, limit),
      total: records.length,
    };
  },
});
