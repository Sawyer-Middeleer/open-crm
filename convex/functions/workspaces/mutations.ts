import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog } from "../../lib/audit";

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
    await seedSystemObjectTypes(ctx, workspaceId, memberId);

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

// Seed data definitions for system object types
const SEED_OBJECT_TYPES = {
  people: {
    name: "People",
    slug: "people",
    singularName: "Person",
    description: "Individual contacts and leads",
    primaryAttribute: "full_name",
    attributes: [
      { name: "Full Name", slug: "full_name", type: "text", isRequired: true, isSearchable: true },
      { name: "Email", slug: "email", type: "email", isUnique: true, isSearchable: true },
      { name: "Phone", slug: "phone", type: "phone" },
      { name: "Title", slug: "title", type: "text" },
      { name: "Notes", slug: "notes", type: "richText" },
    ],
  },
  companies: {
    name: "Companies",
    slug: "companies",
    singularName: "Company",
    description: "Organizations and businesses",
    primaryAttribute: "name",
    attributes: [
      { name: "Name", slug: "name", type: "text", isRequired: true, isSearchable: true },
      { name: "Domain", slug: "domain", type: "url" },
      {
        name: "Industry",
        slug: "industry",
        type: "select",
        config: {
          options: [
            { value: "technology", label: "Technology" },
            { value: "finance", label: "Finance" },
            { value: "healthcare", label: "Healthcare" },
            { value: "retail", label: "Retail" },
            { value: "manufacturing", label: "Manufacturing" },
            { value: "other", label: "Other" },
          ],
        },
      },
      {
        name: "Size",
        slug: "size",
        type: "select",
        config: {
          options: [
            { value: "1-10", label: "1-10" },
            { value: "11-50", label: "11-50" },
            { value: "51-200", label: "51-200" },
            { value: "201-500", label: "201-500" },
            { value: "501-1000", label: "501-1000" },
            { value: "1000+", label: "1000+" },
          ],
        },
      },
      { name: "Notes", slug: "notes", type: "richText" },
    ],
  },
  deals: {
    name: "Deals",
    slug: "deals",
    singularName: "Deal",
    description: "Sales opportunities and transactions",
    primaryAttribute: "name",
    attributes: [
      { name: "Name", slug: "name", type: "text", isRequired: true, isSearchable: true },
      { name: "Value", slug: "value", type: "currency" },
      {
        name: "Stage",
        slug: "stage",
        type: "select",
        config: {
          options: [
            { value: "lead", label: "Lead", color: "gray" },
            { value: "qualified", label: "Qualified", color: "blue" },
            { value: "proposal", label: "Proposal", color: "yellow" },
            { value: "negotiation", label: "Negotiation", color: "orange" },
            { value: "won", label: "Won", color: "green" },
            { value: "lost", label: "Lost", color: "red" },
          ],
        },
      },
      { name: "Close Date", slug: "close_date", type: "date" },
      { name: "Notes", slug: "notes", type: "richText" },
    ],
  },
} as const;

// Reference attributes linking object types
const SEED_REFERENCES = [
  { fromType: "people", name: "Company", slug: "company", toType: "companies" },
  { fromType: "deals", name: "Company", slug: "company", toType: "companies" },
  { fromType: "deals", name: "Primary Contact", slug: "primary_contact", toType: "people" },
];

// List definitions with their attributes
const SEED_LISTS = [
  {
    name: "Contacts",
    slug: "contacts",
    description: "People associated with a company",
    allowedType: "people",
    parentType: "companies",
    attributes: [
      { name: "Role", slug: "role", type: "text" },
      { name: "Is Primary", slug: "is_primary", type: "boolean" },
    ],
  },
  {
    name: "Deal Contacts",
    slug: "deal_contacts",
    description: "People involved in a deal",
    allowedType: "people",
    parentType: "deals",
    attributes: [
      {
        name: "Involvement",
        slug: "involvement",
        type: "select",
        config: {
          options: [
            { value: "decision_maker", label: "Decision Maker" },
            { value: "influencer", label: "Influencer" },
            { value: "champion", label: "Champion" },
            { value: "end_user", label: "End User" },
          ],
        },
      },
    ],
  },
];

type SeedAttr = (typeof SEED_OBJECT_TYPES)[keyof typeof SEED_OBJECT_TYPES]["attributes"][number];

async function seedSystemObjectTypes(
  ctx: any,
  workspaceId: string,
  _memberId: string
) {
  const now = Date.now();
  const objectTypeIds: Record<string, string> = {};

  // Create object types and their attributes
  for (const [key, def] of Object.entries(SEED_OBJECT_TYPES)) {
    const objectTypeId = await ctx.db.insert("objectTypes", {
      workspaceId,
      name: def.name,
      slug: def.slug,
      singularName: def.singularName,
      description: def.description,
      isSystem: true,
      isActive: true,
      displayConfig: { primaryAttribute: def.primaryAttribute },
      createdAt: now,
      updatedAt: now,
    });
    objectTypeIds[key] = objectTypeId;

    // Insert attributes
    for (let i = 0; i < def.attributes.length; i++) {
      const attr = def.attributes[i] as SeedAttr;
      await ctx.db.insert("attributes", {
        workspaceId,
        objectTypeId,
        name: attr.name,
        slug: attr.slug,
        type: attr.type,
        isSystem: true,
        isRequired: "isRequired" in attr ? attr.isRequired : false,
        isUnique: "isUnique" in attr ? attr.isUnique : false,
        isSearchable: "isSearchable" in attr ? attr.isSearchable : false,
        isFilterable: true,
        sortOrder: i,
        config: "config" in attr ? attr.config : {},
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Create reference attributes
  for (const ref of SEED_REFERENCES) {
    const fromTypeId = objectTypeIds[ref.fromType];
    const toTypeId = objectTypeIds[ref.toType];
    const fromDef = SEED_OBJECT_TYPES[ref.fromType as keyof typeof SEED_OBJECT_TYPES];

    await ctx.db.insert("attributes", {
      workspaceId,
      objectTypeId: fromTypeId,
      name: ref.name,
      slug: ref.slug,
      type: "reference",
      isSystem: true,
      isRequired: false,
      isUnique: false,
      isSearchable: false,
      isFilterable: true,
      sortOrder: fromDef.attributes.length,
      config: { referencedObjectTypeId: toTypeId },
      createdAt: now,
      updatedAt: now,
    });
  }

  // Create lists and their attributes
  for (const listDef of SEED_LISTS) {
    const listId = await ctx.db.insert("lists", {
      workspaceId,
      name: listDef.name,
      slug: listDef.slug,
      description: listDef.description,
      allowedObjectTypeIds: [objectTypeIds[listDef.allowedType]],
      parentObjectTypeId: objectTypeIds[listDef.parentType],
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < listDef.attributes.length; i++) {
      const attr = listDef.attributes[i];
      await ctx.db.insert("listAttributes", {
        workspaceId,
        listId,
        name: attr.name,
        slug: attr.slug,
        type: attr.type,
        isRequired: false,
        sortOrder: i,
        config: "config" in attr ? attr.config : {},
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

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
