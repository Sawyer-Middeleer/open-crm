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
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    parentObjectType: v.optional(v.string()), // slug
    allowedObjectTypes: v.array(v.string()), // slugs
    icon: v.optional(v.string()),
    attributes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          slug: v.string(),
          type: attributeTypeValidator,
          isRequired: v.optional(v.boolean()),
          config: v.optional(v.any()),
        })
      )
    ),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Check for duplicate slug
    const existing = await ctx.db
      .query("lists")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug)
      )
      .first();

    if (existing) {
      throw new Error(`List with slug '${args.slug}' already exists`);
    }

    // Resolve parent object type
    let parentObjectTypeId: string | undefined;
    let parentObjectType: { name: string; slug: string } | null = null;

    if (args.parentObjectType) {
      const parentOT = await ctx.db
        .query("objectTypes")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", args.parentObjectType!)
        )
        .first();

      if (!parentOT) {
        throw new Error(`Parent object type '${args.parentObjectType}' not found`);
      }
      parentObjectTypeId = parentOT._id;
      parentObjectType = { name: parentOT.name, slug: parentOT.slug };
    }

    // Resolve allowed object types
    if (args.allowedObjectTypes.length === 0) {
      throw new Error("At least one allowed object type is required");
    }

    const allowedObjectTypeIds: string[] = [];
    const allowedObjectTypes: Array<{ name: string; slug: string }> = [];

    for (const slug of args.allowedObjectTypes) {
      const ot = await ctx.db
        .query("objectTypes")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", slug)
        )
        .first();

      if (!ot) {
        throw new Error(`Object type '${slug}' not found`);
      }
      allowedObjectTypeIds.push(ot._id);
      allowedObjectTypes.push({ name: ot.name, slug: ot.slug });
    }

    const now = Date.now();

    // Create the list
    const listId = await ctx.db.insert("lists", {
      workspaceId: args.workspaceId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      allowedObjectTypeIds: allowedObjectTypeIds as never,
      parentObjectTypeId: parentObjectTypeId as never,
      isSystem: false,
      icon: args.icon,
      createdAt: now,
      updatedAt: now,
    });

    // Create list attributes
    const createdAttributes: Array<{ name: string; slug: string; type: string }> = [];

    if (args.attributes && args.attributes.length > 0) {
      // Check for duplicate slugs
      const slugs = args.attributes.map((a) => a.slug);
      const uniqueSlugs = new Set(slugs);
      if (slugs.length !== uniqueSlugs.size) {
        throw new Error("Duplicate attribute slugs in list");
      }

      for (let i = 0; i < args.attributes.length; i++) {
        const attr = args.attributes[i];
        await ctx.db.insert("listAttributes", {
          workspaceId: args.workspaceId,
          listId,
          name: attr.name,
          slug: attr.slug,
          type: attr.type,
          isRequired: attr.isRequired ?? false,
          sortOrder: i,
          config: attr.config ?? {},
          createdAt: now,
          updatedAt: now,
        });
        createdAttributes.push({ name: attr.name, slug: attr.slug, type: attr.type });
      }
    }

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "list",
      entityId: listId,
      action: "create",
      changes: [
        { field: "name", after: args.name },
        { field: "slug", after: args.slug },
      ],
      actorId: args.actorId,
      actorType: "user",
    });

    return {
      listId,
      list: {
        name: args.name,
        slug: args.slug,
        description: args.description,
        parentObjectType,
        allowedObjectTypes,
        attributes: createdAttributes,
      },
    };
  },
});

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
