import { query } from "../../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { assertActorInWorkspace } from "../../lib/auth";

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

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
    paginationOpts: paginationOptsValidator,
    includeArchived: v.optional(v.boolean()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

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

    // Query records with proper cursor-based pagination
    let query = ctx.db
      .query("records")
      .withIndex("by_workspace_object_type", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("objectTypeId", objectType._id)
      );

    // Filter out archived records unless includeArchived is true
    if (!args.includeArchived) {
      query = query.filter((q) => q.eq(q.field("archivedAt"), undefined));
    }

    const results = await query.order("desc").paginate(args.paginationOpts);

    return {
      page: results.page,
      isDone: results.isDone,
      continueCursor: results.continueCursor,
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

// Helper to check if a record matches filters
function matchesFilters(
  record: { data: unknown },
  filters: Array<{ field: string; operator: FilterOperator; value?: unknown }>
): boolean {
  if (!filters || filters.length === 0) return true;
  return filters.every((filter) =>
    matchesFilter(record.data as Record<string, unknown>, filter as Filter)
  );
}

// Helper to check if a record matches text query
function matchesTextQuery(
  record: { displayName?: string | null; data: unknown },
  queryText: string
): boolean {
  const queryLower = queryText.toLowerCase();

  // Search in displayName
  if (record.displayName?.toLowerCase().includes(queryLower)) {
    return true;
  }

  // Search in all text fields
  const data = record.data as Record<string, unknown>;
  for (const value of Object.values(data)) {
    if (typeof value === "string" && value.toLowerCase().includes(queryLower)) {
      return true;
    }
  }

  return false;
}

// Type for record from database
type RecordDoc = {
  _id: string;
  _creationTime: number;
  workspaceId: string;
  objectTypeId: string;
  displayName?: string | null;
  data: unknown;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
};

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
    includeArchived: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Safety limits to prevent OOM
    const MAX_SCAN_LIMIT = 10000; // Max records to scan
    const CHUNK_SIZE = 100; // Records per chunk
    const pageSize = args.paginationOpts.numItems ?? 50;

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

    // 2. Fetch records in chunks with filtering
    const results: RecordDoc[] = [];
    let scanned = 0;
    let cursor = args.paginationOpts.cursor;
    let isDone = false;
    const hasFilters = (args.filters && args.filters.length > 0) || args.query;

    // Fetch chunks until we have enough results or hit limits
    while (results.length < pageSize && scanned < MAX_SCAN_LIMIT && !isDone) {
      // Build the query based on whether we have objectTypeId
      let chunk;
      if (objectTypeId) {
        chunk = await ctx.db
          .query("records")
          .withIndex("by_workspace_object_type", (q) =>
            q
              .eq("workspaceId", args.workspaceId)
              .eq("objectTypeId", objectTypeId as never)
          )
          .paginate({ numItems: CHUNK_SIZE, cursor });
      } else {
        chunk = await ctx.db
          .query("records")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
          .paginate({ numItems: CHUNK_SIZE, cursor });
      }

      // Filter this chunk in memory
      for (const record of chunk.page) {
        const recordDoc = record as unknown as RecordDoc;

        // Filter out archived records unless includeArchived is true
        if (!args.includeArchived && recordDoc.archivedAt !== undefined) {
          continue;
        }

        // Apply filters
        if (args.filters && args.filters.length > 0) {
          if (!matchesFilters(recordDoc, args.filters as Array<{ field: string; operator: FilterOperator; value?: unknown }>)) {
            continue;
          }
        }

        // Apply text search
        if (args.query) {
          if (!matchesTextQuery(recordDoc, args.query)) {
            continue;
          }
        }

        results.push(recordDoc);
      }

      scanned += chunk.page.length;
      cursor = chunk.continueCursor;
      isDone = chunk.isDone;
    }

    // 3. Sort results
    if (args.sortBy) {
      const sortOrder = args.sortOrder ?? "asc";
      results.sort((a, b) => {
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
      results.sort((a, b) => b.createdAt - a.createdAt);
    }

    // 4. Return paginated results
    const page = results.slice(0, pageSize);
    const truncated = scanned >= MAX_SCAN_LIMIT && !isDone;

    return {
      page,
      continueCursor: cursor,
      isDone: isDone && results.length <= pageSize,
      scanned,
      truncated,
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
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

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
      const ot = await ctx.db.get(objectTypeId as never) as { name: string; slug: string } | null;
      return ot ? { name: ot.name, slug: ot.slug } : null;
    };

    // 3. Outbound references (this record points to others)
    const refAttributes = attributes.filter((a) => a.type === "reference");
    for (const attr of refAttributes) {
      if (args.relationship && args.relationship !== attr.slug) continue;

      const refId = (record.data as Record<string, unknown>)[attr.slug] as string | undefined;
      if (refId) {
        const refRecord = await ctx.db.get(refId as never) as { _id: string; displayName?: string; data: unknown; objectTypeId: string } | null;
        if (refRecord) {
          relationships.push({
            type: "reference",
            slug: attr.slug,
            direction: "outbound",
            records: [
              {
                _id: refRecord._id,
                displayName: refRecord.displayName ?? null,
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
              displayName: r.displayName ?? null,
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
            const entryRecord = await ctx.db.get(e.recordId) as { _id: string; displayName?: string; data: unknown; objectTypeId: string } | null;
            if (!entryRecord) return null;
            return {
              _id: entryRecord._id,
              displayName: entryRecord.displayName ?? null,
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
        const parentRecord = await ctx.db.get(entry.parentRecordId) as { _id: string; displayName?: string; data: unknown; objectTypeId: string } | null;
        if (parentRecord) {
          const existing = relationships.find(
            (r) => r.type === "list" && r.slug === list.slug && r.direction === "inbound"
          );
          const parentData = {
            _id: parentRecord._id,
            displayName: parentRecord.displayName ?? null,
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

export const bulkInspect = query({
  args: {
    workspaceId: v.id("workspaces"),
    sessionId: v.id("bulkValidationSessions"),
    indices: v.array(v.number()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const session = await ctx.db.get(args.sessionId);

    if (!session) {
      throw new Error("Validation session not found");
    }

    if (session.workspaceId !== args.workspaceId) {
      throw new Error("Session not found in this workspace");
    }

    const records = args.indices
      .filter((idx) => idx >= 0 && idx < session.records.length)
      .map((idx) => ({
        index: idx,
        ...session.records[idx],
      }));

    return {
      sessionId: args.sessionId,
      status: session.status,
      records,
    };
  },
});
