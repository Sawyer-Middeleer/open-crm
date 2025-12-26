import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog, computeChanges } from "../../lib/audit";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.string(),
    data: v.any(),
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

    // Get attributes to compute display name
    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", objectType._id))
      .collect();

    // Compute display name from primary attribute
    let displayName: string | undefined;
    if (objectType.displayConfig.primaryAttribute) {
      displayName = String(args.data[objectType.displayConfig.primaryAttribute] ?? "");
    }

    const now = Date.now();

    // Create the record
    const recordId = await ctx.db.insert("records", {
      workspaceId: args.workspaceId,
      objectTypeId: objectType._id,
      data: args.data,
      displayName,
      createdBy: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    // Create audit log
    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: recordId,
      objectTypeId: objectType._id,
      action: "create",
      changes: Object.entries(args.data).map(([field, value]) => ({
        field,
        after: value,
      })),
      afterSnapshot: args.data,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    const record = await ctx.db.get(recordId);

    return {
      recordId,
      record,
    };
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    data: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.recordId);

    if (!existing) {
      throw new Error("Record not found");
    }

    if (existing.workspaceId !== args.workspaceId) {
      throw new Error("Record not found in this workspace");
    }

    const objectType = await ctx.db.get(existing.objectTypeId);
    if (!objectType) {
      throw new Error("Object type not found");
    }

    // Merge data
    const newData = { ...existing.data, ...args.data };

    // Recompute display name
    let displayName = existing.displayName;
    if (objectType.displayConfig.primaryAttribute) {
      displayName = String(newData[objectType.displayConfig.primaryAttribute] ?? "");
    }

    const now = Date.now();

    // Compute changes for audit
    const changes = computeChanges(existing.data, newData);

    // Update the record
    await ctx.db.patch(args.recordId, {
      data: newData,
      displayName,
      updatedAt: now,
    });

    // Create audit log
    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: args.recordId,
      objectTypeId: existing.objectTypeId,
      action: "update",
      changes,
      beforeSnapshot: existing.data,
      afterSnapshot: newData,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    const record = await ctx.db.get(args.recordId);

    return {
      recordId: args.recordId,
      record,
    };
  },
});

export const remove = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.recordId);

    if (!existing) {
      throw new Error("Record not found");
    }

    if (existing.workspaceId !== args.workspaceId) {
      throw new Error("Record not found in this workspace");
    }

    // Create audit log before deletion
    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: args.recordId,
      objectTypeId: existing.objectTypeId,
      action: "delete",
      changes: [],
      beforeSnapshot: existing.data,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    // Delete list entries for this record
    const listEntries = await ctx.db
      .query("listEntries")
      .withIndex("by_record", (q) => q.eq("recordId", args.recordId))
      .collect();

    for (const entry of listEntries) {
      await ctx.db.delete(entry._id);
    }

    // Delete the record
    await ctx.db.delete(args.recordId);

    return { success: true };
  },
});
