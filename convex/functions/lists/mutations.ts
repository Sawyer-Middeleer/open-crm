import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog } from "../../lib/audit";

export const addEntry = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    listSlug: v.string(),
    recordId: v.id("records"),
    parentRecordId: v.optional(v.id("records")),
    data: v.any(),
    actorId: v.id("workspaceMembers"),
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

    // Check if record exists
    const record = await ctx.db.get(args.recordId);
    if (!record || record.workspaceId !== args.workspaceId) {
      throw new Error("Record not found");
    }

    // Check for duplicate entry
    const existingEntries = await ctx.db
      .query("listEntries")
      .withIndex("by_list_record", (q) =>
        q.eq("listId", list._id).eq("recordId", args.recordId)
      )
      .collect();

    const duplicate = existingEntries.find(
      (e) =>
        (!args.parentRecordId && !e.parentRecordId) ||
        e.parentRecordId === args.parentRecordId
    );

    if (duplicate) {
      throw new Error("Record is already in this list");
    }

    const now = Date.now();

    const entryId = await ctx.db.insert("listEntries", {
      workspaceId: args.workspaceId,
      listId: list._id,
      recordId: args.recordId,
      parentRecordId: args.parentRecordId,
      data: args.data ?? {},
      addedBy: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "listEntry",
      entityId: entryId,
      action: "create",
      changes: [
        { field: "listSlug", after: args.listSlug },
        { field: "recordId", after: args.recordId },
      ],
      afterSnapshot: args.data,
      actorId: args.actorId,
      actorType: "user",
    });

    const entry = await ctx.db.get(entryId);

    return { entryId, entry };
  },
});

export const updateEntry = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    entryId: v.id("listEntries"),
    data: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.entryId);

    if (!existing || existing.workspaceId !== args.workspaceId) {
      throw new Error("List entry not found");
    }

    const newData = { ...existing.data, ...args.data };

    await ctx.db.patch(args.entryId, {
      data: newData,
      updatedAt: Date.now(),
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "listEntry",
      entityId: args.entryId,
      action: "update",
      changes: Object.entries(args.data).map(([field, value]) => ({
        field,
        before: existing.data[field],
        after: value,
      })),
      beforeSnapshot: existing.data,
      afterSnapshot: newData,
      actorId: args.actorId,
      actorType: "user",
    });

    const entry = await ctx.db.get(args.entryId);

    return { entry };
  },
});

export const removeEntry = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    listSlug: v.string(),
    recordId: v.id("records"),
    parentRecordId: v.optional(v.id("records")),
    actorId: v.id("workspaceMembers"),
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

    const entries = await ctx.db
      .query("listEntries")
      .withIndex("by_list_record", (q) =>
        q.eq("listId", list._id).eq("recordId", args.recordId)
      )
      .collect();

    const entry = entries.find(
      (e) =>
        (!args.parentRecordId && !e.parentRecordId) ||
        e.parentRecordId === args.parentRecordId
    );

    if (!entry) {
      throw new Error("List entry not found");
    }

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "listEntry",
      entityId: entry._id,
      action: "delete",
      changes: [],
      beforeSnapshot: entry.data,
      actorId: args.actorId,
      actorType: "user",
    });

    await ctx.db.delete(entry._id);

    return { success: true };
  },
});
