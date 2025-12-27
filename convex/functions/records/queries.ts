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

const filterOperator = v.union(
  v.literal("equals"),
  v.literal("notEquals"),
  v.literal("contains"),
  v.literal("notContains"),
  v.literal("greaterThan"),
  v.literal("lessThan"),
  v.literal("greaterThanOrEquals"),
  v.literal("lessThanOrEquals"),
  v.literal("isEmpty"),
  v.literal("isNotEmpty"),
  v.literal("in"),
  v.literal("notIn")
);

type FilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEquals"
  | "lessThanOrEquals"
  | "isEmpty"
  | "isNotEmpty"
  | "in"
  | "notIn";

interface Filter {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

function matchesFilter(data: Record<string, unknown>, filter: Filter): boolean {
  const value = data[filter.field];

  switch (filter.operator) {
    case "equals":
      return value === filter.value;
    case "notEquals":
      return value !== filter.value;
    case "contains":
      if (value === null || value === undefined) return false;
      return String(value)
        .toLowerCase()
        .includes(String(filter.value).toLowerCase());
    case "notContains":
      if (value === null || value === undefined) return true;
      return !String(value)
        .toLowerCase()
        .includes(String(filter.value).toLowerCase());
    case "greaterThan":
      return (value as number) > (filter.value as number);
    case "lessThan":
      return (value as number) < (filter.value as number);
    case "greaterThanOrEquals":
      return (value as number) >= (filter.value as number);
    case "lessThanOrEquals":
      return (value as number) <= (filter.value as number);
    case "isEmpty":
      return value === null || value === undefined || value === "";
    case "isNotEmpty":
      return value !== null && value !== undefined && value !== "";
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(value);
    case "notIn":
      return Array.isArray(filter.value) && !filter.value.includes(value);
    default:
      return true;
  }
}

export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.optional(v.string()),
    filters: v.optional(
      v.array(
        v.object({
          field: v.string(),
          operator: filterOperator,
          value: v.optional(v.any()),
        })
      )
    ),
    query: v.optional(v.string()), // text search on displayName
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // 1. Get object type if specified
    let objectTypeId: string | undefined;
    let objectType = null;

    if (args.objectTypeSlug) {
      objectType = await ctx.db
        .query("objectTypes")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", args.objectTypeSlug!)
        )
        .first();

      if (objectType) {
        objectTypeId = objectType._id;
      }
    }

    // 2. Fetch records by workspace (and optionally objectType)
    let records;
    if (objectTypeId) {
      records = await ctx.db
        .query("records")
        .withIndex("by_workspace_object_type", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("objectTypeId", objectTypeId as never)
        )
        .collect();
    } else {
      records = await ctx.db
        .query("records")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
    }

    // 3. Apply filters in memory
    if (args.filters && args.filters.length > 0) {
      records = records.filter((record) => {
        return args.filters!.every((filter) =>
          matchesFilter(record.data as Record<string, unknown>, filter as Filter)
        );
      });
    }

    // 4. Apply text search if query provided
    if (args.query) {
      const queryLower = args.query.toLowerCase();
      records = records.filter((record) => {
        // Search in displayName
        if (record.displayName?.toLowerCase().includes(queryLower)) {
          return true;
        }
        // Search in all text fields
        const data = record.data as Record<string, unknown>;
        for (const value of Object.values(data)) {
          if (
            typeof value === "string" &&
            value.toLowerCase().includes(queryLower)
          ) {
            return true;
          }
        }
        return false;
      });
    }

    // 5. Sort results
    if (args.sortBy) {
      const sortOrder = args.sortOrder ?? "asc";
      records.sort((a, b) => {
        const aData = a.data as Record<string, unknown>;
        const bData = b.data as Record<string, unknown>;
        const aVal = args.sortBy === "_createdAt" ? a.createdAt : aData[args.sortBy!];
        const bVal = args.sortBy === "_createdAt" ? b.createdAt : bData[args.sortBy!];

        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const comparison = aVal < bVal ? -1 : 1;
        return sortOrder === "asc" ? comparison : -comparison;
      });
    } else {
      // Default sort by createdAt desc
      records.sort((a, b) => b.createdAt - a.createdAt);
    }

    // 6. Return paginated results
    const total = records.length;
    const items = records.slice(0, limit);

    return {
      items,
      total,
      hasMore: total > limit,
      objectType: objectType
        ? {
            name: objectType.name,
            slug: objectType.slug,
            singularName: objectType.singularName,
          }
        : undefined,
    };
  },
});

export const getRelated = query({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    relationship: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Get source record
    const record = await ctx.db.get(args.recordId);
    if (!record || record.workspaceId !== args.workspaceId) {
      throw new Error("Record not found");
    }

    // 2. Get object type and its attributes
    const objectType = await ctx.db.get(record.objectTypeId);
    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", record.objectTypeId))
      .collect();

    const relationships: Array<{
      type: "reference" | "list";
      slug: string;
      direction: "outbound" | "inbound";
      records: Array<{
        _id: string;
        displayName: string | null;
        data: Record<string, unknown>;
        objectType: { name: string; slug: string } | null;
        listEntryData?: Record<string, unknown>;
      }>;
    }> = [];

    // Helper to get object type info
    const getObjectTypeInfo = async (objectTypeId: string) => {
      const ot = await ctx.db.get(objectTypeId as never);
      return ot ? { name: ot.name, slug: ot.slug } : null;
    };

    // 3. Outbound references (this record points to others)
    const refAttributes = attributes.filter((a) => a.type === "reference");
    for (const attr of refAttributes) {
      if (args.relationship && args.relationship !== attr.slug) continue;

      const refId = (record.data as Record<string, unknown>)[attr.slug] as string | undefined;
      if (refId) {
        const refRecord = await ctx.db.get(refId as never);
        if (refRecord) {
          relationships.push({
            type: "reference",
            slug: attr.slug,
            direction: "outbound",
            records: [
              {
                _id: refRecord._id,
                displayName: refRecord.displayName,
                data: refRecord.data as Record<string, unknown>,
                objectType: await getObjectTypeInfo(refRecord.objectTypeId),
              },
            ],
          });
        }
      }
    }

    // 4. Inbound references (other records point to this one)
    const allRefAttributes = await ctx.db
      .query("attributes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("type"), "reference"))
      .collect();

    for (const attr of allRefAttributes) {
      const attrConfig = attr.config as { referencedObjectTypeId?: string } | undefined;
      if (attrConfig?.referencedObjectTypeId !== record.objectTypeId) continue;
      if (args.relationship && args.relationship !== attr.slug) continue;

      const inboundRecords = await ctx.db
        .query("records")
        .withIndex("by_workspace_object_type", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("objectTypeId", attr.objectTypeId)
        )
        .collect();

      const matching = inboundRecords.filter(
        (r) => (r.data as Record<string, unknown>)[attr.slug] === args.recordId
      );

      if (matching.length > 0) {
        relationships.push({
          type: "reference",
          slug: attr.slug,
          direction: "inbound",
          records: await Promise.all(
            matching.map(async (r) => ({
              _id: r._id,
              displayName: r.displayName,
              data: r.data as Record<string, unknown>,
              objectType: await getObjectTypeInfo(r.objectTypeId),
            }))
          ),
        });
      }
    }

    // 5. List relationships (as parent - e.g., Company → Contacts)
    const listsAsParent = await ctx.db
      .query("lists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("parentObjectTypeId"), record.objectTypeId))
      .collect();

    for (const list of listsAsParent) {
      if (args.relationship && args.relationship !== list.slug) continue;

      const entries = await ctx.db
        .query("listEntries")
        .withIndex("by_list_parent", (q) =>
          q.eq("listId", list._id).eq("parentRecordId", args.recordId)
        )
        .collect();

      if (entries.length > 0) {
        const entryRecords = await Promise.all(
          entries.map(async (e) => {
            const entryRecord = await ctx.db.get(e.recordId);
            if (!entryRecord) return null;
            return {
              _id: entryRecord._id,
              displayName: entryRecord.displayName,
              data: entryRecord.data as Record<string, unknown>,
              objectType: await getObjectTypeInfo(entryRecord.objectTypeId),
              listEntryData: e.data as Record<string, unknown>,
            };
          })
        );
        relationships.push({
          type: "list",
          slug: list.slug,
          direction: "outbound",
          records: entryRecords.filter((r): r is NonNullable<typeof r> => r !== null),
        });
      }
    }

    // 6. List relationships (as member - e.g., Person ← Companies via Contacts list)
    const memberEntries = await ctx.db
      .query("listEntries")
      .withIndex("by_record", (q) => q.eq("recordId", args.recordId))
      .collect();

    for (const entry of memberEntries) {
      const list = await ctx.db.get(entry.listId);
      if (!list || (args.relationship && args.relationship !== list.slug)) continue;

      if (entry.parentRecordId) {
        const parentRecord = await ctx.db.get(entry.parentRecordId);
        if (parentRecord) {
          const existing = relationships.find(
            (r) => r.type === "list" && r.slug === list.slug && r.direction === "inbound"
          );
          const parentData = {
            _id: parentRecord._id,
            displayName: parentRecord.displayName,
            data: parentRecord.data as Record<string, unknown>,
            objectType: await getObjectTypeInfo(parentRecord.objectTypeId),
            listEntryData: entry.data as Record<string, unknown>,
          };

          if (existing) {
            existing.records.push(parentData);
          } else {
            relationships.push({
              type: "list",
              slug: list.slug,
              direction: "inbound",
              records: [parentData],
            });
          }
        }
      }
    }

    return {
      record: {
        _id: record._id,
        displayName: record.displayName,
        objectType: objectType
          ? { name: objectType.name, slug: objectType.slug }
          : null,
      },
      relationships,
    };
  },
});
