// Note: Using 'any' for ctx to match original implementation and avoid
// complex type casting. The function is only called from mutations that
// already have proper type checking on inputs.

// Seed data definitions for system object types
export const SEED_OBJECT_TYPES = {
  people: {
    name: "People",
    slug: "people",
    singularName: "Person",
    description: "Individual contacts and leads",
    primaryAttribute: "full_name",
    attributes: [
      {
        name: "Full Name",
        slug: "full_name",
        type: "text",
        isRequired: true,
        isSearchable: true,
      },
      {
        name: "Email",
        slug: "email",
        type: "email",
        isUnique: true,
        isSearchable: true,
      },
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
      {
        name: "Name",
        slug: "name",
        type: "text",
        isRequired: true,
        isSearchable: true,
      },
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
      {
        name: "Name",
        slug: "name",
        type: "text",
        isRequired: true,
        isSearchable: true,
      },
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
export const SEED_REFERENCES = [
  {
    fromType: "people",
    name: "Company",
    slug: "company",
    toType: "companies",
  },
  {
    fromType: "deals",
    name: "Company",
    slug: "company",
    toType: "companies",
  },
  {
    fromType: "deals",
    name: "Primary Contact",
    slug: "primary_contact",
    toType: "people",
  },
];

// List definitions with their attributes
export const SEED_LISTS = [
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

type SeedAttr =
  (typeof SEED_OBJECT_TYPES)[keyof typeof SEED_OBJECT_TYPES]["attributes"][number];

/**
 * Seed system object types, attributes, references, and lists for a workspace
 */
export async function seedSystemObjectTypes(
  ctx: any,
  workspaceId: string
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
    const fromDef =
      SEED_OBJECT_TYPES[ref.fromType as keyof typeof SEED_OBJECT_TYPES];

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

/**
 * Generate a unique workspace slug from email
 * Format: {email_local_part}-{6_random_chars}
 */
export function generateWorkspaceSlug(email: string): string {
  const localPart = email.split("@")[0];
  // Sanitize to URL-safe characters
  const sanitized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Generate 6 random alphanumeric characters
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let randomSuffix = "";
  for (let i = 0; i < 6; i++) {
    randomSuffix += chars[Math.floor(Math.random() * chars.length)];
  }

  return `${sanitized || "workspace"}-${randomSuffix}`;
}

/**
 * Generate workspace name from user's name or email
 */
export function generateWorkspaceName(
  name: string | undefined,
  email: string
): string {
  if (name) {
    return `${name}'s Workspace`;
  }
  // Fall back to email local part
  const localPart = email.split("@")[0];
  return `${localPart}'s Workspace`;
}
