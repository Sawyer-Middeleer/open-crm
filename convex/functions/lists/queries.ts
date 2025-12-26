import { query } from "../../_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const lists = await ctx.db
      .query("lists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return lists.map((l) => ({
      id: l._id,
      name: l.name,
      slug: l.slug,
      description: l.description,
      isSystem: l.isSystem,
      icon: l.icon,
    }));
  },
});

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("lists")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    if (!list) {
      return null;
    }

    const listAttributes = await ctx.db
      .query("listAttributes")
      .withIndex("by_list", (q) => q.eq("listId", list._id))
      .collect();

    listAttributes.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      ...list,
      attributes: listAttributes,
    };
  },
});

export const getEntries = query({
  args: {
    workspaceId: v.id("workspaces"),
    listSlug: v.string(),
    parentRecordId: v.optional(v.id("records")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("lists")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.listSlug)
      )
      .first();

    if (!list) {
      throw new Error(`List '${args.listSlug}' not found`);
    }

    let entries;

    if (args.parentRecordId) {
      entries = await ctx.db
        .query("listEntries")
        .withIndex("by_list_parent", (q) =>
          q.eq("listId", list._id).eq("parentRecordId", args.parentRecordId)
        )
        .collect();
    } else {
      entries = await ctx.db
        .query("listEntries")
        .withIndex("by_list", (q) => q.eq("listId", list._id))
        .collect();
    }

    // Fetch the referenced records
    const entriesWithRecords = await Promise.all(
      entries.map(async (entry) => {
        const record = await ctx.db.get(entry.recordId);
        return {
          ...entry,
          record: record
            ? {
                id: record._id,
                displayName: record.displayName,
                data: record.data,
              }
            : null,
        };
      })
    );

    const limit = args.limit ?? 100;

    return {
      list: {
        id: list._id,
        name: list.name,
        slug: list.slug,
      },
      entries: entriesWithRecords.slice(0, limit),
      total: entriesWithRecords.length,
    };
  },
});
