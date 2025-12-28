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

async function seedSystemObjectTypes(
  ctx: any,
  workspaceId: string,
  memberId: string
) {
  const now = Date.now();

  // Create People object type
  const peopleId = await ctx.db.insert("objectTypes", {
    workspaceId,
    name: "People",
    slug: "people",
    singularName: "Person",
    description: "Individual contacts and leads",
    isSystem: true,
    isActive: true,
    displayConfig: {
      primaryAttribute: "full_name",
    },
    createdAt: now,
    updatedAt: now,
  });

  // People attributes
  const peopleAttributes = [
    { name: "Full Name", slug: "full_name", type: "text" as const, isRequired: true },
    { name: "Email", slug: "email", type: "email" as const, isUnique: true },
    { name: "Phone", slug: "phone", type: "phone" as const },
    { name: "Title", slug: "title", type: "text" as const },
    { name: "Notes", slug: "notes", type: "richText" as const },
  ];

  for (let i = 0; i < peopleAttributes.length; i++) {
    const attr = peopleAttributes[i];
    await ctx.db.insert("attributes", {
      workspaceId,
      objectTypeId: peopleId,
      name: attr.name,
      slug: attr.slug,
      type: attr.type,
      isSystem: true,
      isRequired: attr.isRequired ?? false,
      isUnique: attr.isUnique ?? false,
      isSearchable: attr.slug === "full_name" || attr.slug === "email",
      isFilterable: true,
      sortOrder: i,
      config: {},
      createdAt: now,
      updatedAt: now,
    });
  }

  // Create Companies object type
  const companiesId = await ctx.db.insert("objectTypes", {
    workspaceId,
    name: "Companies",
    slug: "companies",
    singularName: "Company",
    description: "Organizations and businesses",
    isSystem: true,
    isActive: true,
    displayConfig: {
      primaryAttribute: "name",
    },
    createdAt: now,
    updatedAt: now,
  });

  // Companies attributes
  const companiesAttributes = [
    { name: "Name", slug: "name", type: "text" as const, isRequired: true },
    { name: "Domain", slug: "domain", type: "url" as const },
    {
      name: "Industry",
      slug: "industry",
      type: "select" as const,
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
      type: "select" as const,
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
    { name: "Notes", slug: "notes", type: "richText" as const },
  ];

  for (let i = 0; i < companiesAttributes.length; i++) {
    const attr = companiesAttributes[i];
    await ctx.db.insert("attributes", {
      workspaceId,
      objectTypeId: companiesId,
      name: attr.name,
      slug: attr.slug,
      type: attr.type,
      isSystem: true,
      isRequired: attr.isRequired ?? false,
      isUnique: false,
      isSearchable: attr.slug === "name",
      isFilterable: true,
      sortOrder: i,
      config: attr.config ?? {},
      createdAt: now,
      updatedAt: now,
    });
  }

  // Add company reference to People
  await ctx.db.insert("attributes", {
    workspaceId,
    objectTypeId: peopleId,
    name: "Company",
    slug: "company",
    type: "reference",
    isSystem: true,
    isRequired: false,
    isUnique: false,
    isSearchable: false,
    isFilterable: true,
    sortOrder: peopleAttributes.length,
    config: {
      referencedObjectTypeId: companiesId,
    },
    createdAt: now,
    updatedAt: now,
  });

  // Create Deals object type
  const dealsId = await ctx.db.insert("objectTypes", {
    workspaceId,
    name: "Deals",
    slug: "deals",
    singularName: "Deal",
    description: "Sales opportunities and transactions",
    isSystem: true,
    isActive: true,
    displayConfig: {
      primaryAttribute: "name",
    },
    createdAt: now,
    updatedAt: now,
  });

  // Deals attributes
  const dealsAttributes = [
    { name: "Name", slug: "name", type: "text" as const, isRequired: true },
    { name: "Value", slug: "value", type: "currency" as const },
    {
      name: "Stage",
      slug: "stage",
      type: "select" as const,
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
    { name: "Close Date", slug: "close_date", type: "date" as const },
    { name: "Notes", slug: "notes", type: "richText" as const },
  ];

  for (let i = 0; i < dealsAttributes.length; i++) {
    const attr = dealsAttributes[i];
    await ctx.db.insert("attributes", {
      workspaceId,
      objectTypeId: dealsId,
      name: attr.name,
      slug: attr.slug,
      type: attr.type,
      isSystem: true,
      isRequired: attr.isRequired ?? false,
      isUnique: false,
      isSearchable: attr.slug === "name",
      isFilterable: true,
      sortOrder: i,
      config: attr.config ?? {},
      createdAt: now,
      updatedAt: now,
    });
  }

  // Add company and contact references to Deals
  await ctx.db.insert("attributes", {
    workspaceId,
    objectTypeId: dealsId,
    name: "Company",
    slug: "company",
    type: "reference",
    isSystem: true,
    isRequired: false,
    isUnique: false,
    isSearchable: false,
    isFilterable: true,
    sortOrder: dealsAttributes.length,
    config: {
      referencedObjectTypeId: companiesId,
    },
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("attributes", {
    workspaceId,
    objectTypeId: dealsId,
    name: "Primary Contact",
    slug: "primary_contact",
    type: "reference",
    isSystem: true,
    isRequired: false,
    isUnique: false,
    isSearchable: false,
    isFilterable: true,
    sortOrder: dealsAttributes.length + 1,
    config: {
      referencedObjectTypeId: peopleId,
    },
    createdAt: now,
    updatedAt: now,
  });

  // Create Contacts list (People linked to Companies)
  const contactsListId = await ctx.db.insert("lists", {
    workspaceId,
    name: "Contacts",
    slug: "contacts",
    description: "People associated with a company",
    allowedObjectTypeIds: [peopleId],
    parentObjectTypeId: companiesId,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  });

  // Contacts list attributes
  await ctx.db.insert("listAttributes", {
    workspaceId,
    listId: contactsListId,
    name: "Role",
    slug: "role",
    type: "text",
    isRequired: false,
    sortOrder: 0,
    config: {},
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("listAttributes", {
    workspaceId,
    listId: contactsListId,
    name: "Is Primary",
    slug: "is_primary",
    type: "boolean",
    isRequired: false,
    sortOrder: 1,
    config: {},
    createdAt: now,
    updatedAt: now,
  });

  // Create Deal Contacts list (People linked to Deals)
  const dealContactsListId = await ctx.db.insert("lists", {
    workspaceId,
    name: "Deal Contacts",
    slug: "deal_contacts",
    description: "People involved in a deal",
    allowedObjectTypeIds: [peopleId],
    parentObjectTypeId: dealsId,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("listAttributes", {
    workspaceId,
    listId: dealContactsListId,
    name: "Involvement",
    slug: "involvement",
    type: "select",
    isRequired: false,
    sortOrder: 0,
    config: {
      options: [
        { value: "decision_maker", label: "Decision Maker" },
        { value: "influencer", label: "Influencer" },
        { value: "champion", label: "Champion" },
        { value: "end_user", label: "End User" },
      ],
    },
    createdAt: now,
    updatedAt: now,
  });
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
