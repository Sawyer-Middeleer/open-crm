import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ============================================================================
// MULTI-TENANCY
// ============================================================================

const workspaces = defineTable({
  name: v.string(),
  slug: v.string(),
  settings: v.object({
    defaultCurrency: v.optional(v.string()),
    timezone: v.optional(v.string()),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_slug", ["slug"]);

const workspaceMembers = defineTable({
  workspaceId: v.id("workspaces"),
  userId: v.string(), // external auth provider ID
  email: v.string(),
  role: v.union(
    v.literal("owner"),
    v.literal("admin"),
    v.literal("member"),
    v.literal("viewer")
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_user", ["userId"])
  .index("by_workspace_user", ["workspaceId", "userId"]);

// ============================================================================
// DYNAMIC SCHEMA: OBJECT TYPES
// ============================================================================

const objectTypes = defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  slug: v.string(),
  singularName: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  isSystem: v.boolean(),
  isActive: v.boolean(),
  displayConfig: v.object({
    primaryAttribute: v.optional(v.string()),
    secondaryAttribute: v.optional(v.string()),
    color: v.optional(v.string()),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_slug", ["workspaceId", "slug"])
  .index("by_workspace_active", ["workspaceId", "isActive"]);

// ============================================================================
// DYNAMIC SCHEMA: ATTRIBUTES
// ============================================================================

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

const attributes = defineTable({
  workspaceId: v.id("workspaces"),
  objectTypeId: v.id("objectTypes"),
  name: v.string(),
  slug: v.string(),
  type: attributeTypeValidator,
  isSystem: v.boolean(),
  isRequired: v.boolean(),
  isUnique: v.boolean(),
  isSearchable: v.boolean(),
  isFilterable: v.boolean(),
  sortOrder: v.number(),
  defaultValue: v.optional(v.any()),
  config: v.object({
    // For select/multiSelect
    options: v.optional(
      v.array(
        v.object({
          value: v.string(),
          label: v.string(),
          color: v.optional(v.string()),
        })
      )
    ),
    // For reference type
    referencedObjectTypeId: v.optional(v.id("objectTypes")),
    // For number/currency
    precision: v.optional(v.number()),
    currencyCode: v.optional(v.string()),
    // For text
    maxLength: v.optional(v.number()),
    // Validation regex pattern
    pattern: v.optional(v.string()),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_object_type", ["objectTypeId"])
  .index("by_object_type_slug", ["objectTypeId", "slug"])
  .index("by_workspace_searchable", ["workspaceId", "isSearchable"]);

// ============================================================================
// RECORDS (ACTUAL DATA)
// ============================================================================

const records = defineTable({
  workspaceId: v.id("workspaces"),
  objectTypeId: v.id("objectTypes"),
  data: v.any(), // Record<string, any> - attribute slug to value
  displayName: v.optional(v.string()),
  ownerId: v.optional(v.id("workspaceMembers")),
  createdBy: v.id("workspaceMembers"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_object_type", ["objectTypeId"])
  .index("by_workspace_object_type", ["workspaceId", "objectTypeId"])
  .index("by_owner", ["ownerId"])
  .index("by_created_at", ["workspaceId", "createdAt"])
  .index("by_updated_at", ["workspaceId", "updatedAt"]);

// ============================================================================
// BULK IMPORT SESSIONS
// ============================================================================

const bulkValidationSessions = defineTable({
  workspaceId: v.id("workspaces"),
  objectTypeId: v.id("objectTypes"),
  records: v.array(
    v.object({
      data: v.any(),
      externalId: v.optional(v.string()),
      isValid: v.boolean(),
      errors: v.array(v.string()),
      displayName: v.optional(v.string()),
    })
  ),
  summary: v.object({
    total: v.number(),
    valid: v.number(),
    invalid: v.number(),
    errorsByType: v.any(), // { missingRequired: { count, fields }, ... }
  }),
  actorId: v.id("workspaceMembers"),
  status: v.union(
    v.literal("pending"),
    v.literal("committed"),
    v.literal("expired")
  ),
  createdAt: v.number(),
  expiresAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_status", ["status"])
  .index("by_expires", ["expiresAt"]);

// ============================================================================
// LISTS (ATTIO-STYLE MANY-TO-MANY WITH ATTRIBUTES)
// ============================================================================

const lists = defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  slug: v.string(),
  description: v.optional(v.string()),
  allowedObjectTypeIds: v.array(v.id("objectTypes")),
  parentObjectTypeId: v.optional(v.id("objectTypes")),
  isSystem: v.boolean(),
  icon: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_slug", ["workspaceId", "slug"])
  .index("by_parent_type", ["parentObjectTypeId"]);

const listAttributes = defineTable({
  workspaceId: v.id("workspaces"),
  listId: v.id("lists"),
  name: v.string(),
  slug: v.string(),
  type: attributeTypeValidator,
  isRequired: v.boolean(),
  sortOrder: v.number(),
  config: v.object({
    options: v.optional(
      v.array(
        v.object({
          value: v.string(),
          label: v.string(),
          color: v.optional(v.string()),
        })
      )
    ),
    referencedObjectTypeId: v.optional(v.id("objectTypes")),
    precision: v.optional(v.number()),
    currencyCode: v.optional(v.string()),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_list", ["listId"])
  .index("by_list_slug", ["listId", "slug"]);

const listEntries = defineTable({
  workspaceId: v.id("workspaces"),
  listId: v.id("lists"),
  recordId: v.id("records"),
  parentRecordId: v.optional(v.id("records")),
  data: v.any(), // Record<string, any>
  sortOrder: v.optional(v.number()),
  addedBy: v.id("workspaceMembers"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_list", ["listId"])
  .index("by_record", ["recordId"])
  .index("by_list_record", ["listId", "recordId"])
  .index("by_parent", ["parentRecordId"])
  .index("by_list_parent", ["listId", "parentRecordId"])
  .index("by_workspace", ["workspaceId"]);

// ============================================================================
// AUDIT TRAIL
// ============================================================================

const auditLogs = defineTable({
  workspaceId: v.id("workspaces"),
  entityType: v.union(
    v.literal("record"),
    v.literal("listEntry"),
    v.literal("objectType"),
    v.literal("attribute"),
    v.literal("list"),
    v.literal("listAttribute"),
    v.literal("action"),
    v.literal("workspace"),
    v.literal("workspaceMember")
  ),
  entityId: v.string(),
  objectTypeId: v.optional(v.id("objectTypes")),
  action: v.union(
    v.literal("create"),
    v.literal("update"),
    v.literal("delete"),
    v.literal("restore"),
    v.literal("archive"),
    v.literal("action_executed")
  ),
  changes: v.array(
    v.object({
      field: v.string(),
      fieldName: v.optional(v.string()),
      before: v.optional(v.any()),
      after: v.optional(v.any()),
    })
  ),
  beforeSnapshot: v.optional(v.any()),
  afterSnapshot: v.optional(v.any()),
  actorId: v.optional(v.id("workspaceMembers")),
  actorType: v.union(
    v.literal("user"),
    v.literal("system"),
    v.literal("action"),
    v.literal("api")
  ),
  metadata: v.optional(
    v.object({
      actionId: v.optional(v.id("actions")),
      actionExecutionId: v.optional(v.id("actionExecutions")),
      source: v.optional(v.string()),
      ipAddress: v.optional(v.string()),
      userAgent: v.optional(v.string()),
    })
  ),
  timestamp: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_entity", ["entityType", "entityId"])
  .index("by_workspace_entity", ["workspaceId", "entityType", "entityId"])
  .index("by_actor", ["actorId"])
  .index("by_workspace_timestamp", ["workspaceId", "timestamp"])
  .index("by_object_type", ["objectTypeId"])
  .index("by_action", ["action"]);

// ============================================================================
// ACTIONS (COMPOSABLE AUTOMATION)
// ============================================================================

const actionStepTypeValidator = v.union(
  // Field operations
  v.literal("updateField"),
  v.literal("clearField"),
  v.literal("copyField"),
  v.literal("transformField"),
  // Record operations
  v.literal("createRecord"),
  v.literal("deleteRecord"),
  v.literal("archiveRecord"),
  // List operations
  v.literal("addToList"),
  v.literal("removeFromList"),
  v.literal("updateListEntry"),
  // External
  v.literal("sendWebhook"),
  // Control flow
  v.literal("condition"),
  v.literal("loop"),
  // Meta
  v.literal("callMcpTool")
);

const actions = defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  slug: v.string(),
  description: v.optional(v.string()),
  trigger: v.object({
    type: v.union(
      v.literal("manual"),
      v.literal("onCreate"),
      v.literal("onUpdate"),
      v.literal("onDelete"),
      v.literal("onFieldChange"),
      v.literal("onListAdd"),
      v.literal("onListRemove"),
      v.literal("scheduled")
    ),
    objectTypeId: v.optional(v.id("objectTypes")),
    listId: v.optional(v.id("lists")),
    watchedFields: v.optional(v.array(v.string())),
    schedule: v.optional(v.string()),
  }),
  conditions: v.optional(
    v.array(
      v.object({
        field: v.string(),
        operator: v.union(
          v.literal("equals"),
          v.literal("notEquals"),
          v.literal("contains"),
          v.literal("notContains"),
          v.literal("greaterThan"),
          v.literal("lessThan"),
          v.literal("isEmpty"),
          v.literal("isNotEmpty"),
          v.literal("in"),
          v.literal("notIn")
        ),
        value: v.any(),
        logic: v.optional(v.union(v.literal("and"), v.literal("or"))),
      })
    )
  ),
  steps: v.array(
    v.object({
      id: v.string(),
      type: actionStepTypeValidator,
      name: v.optional(v.string()),
      config: v.any(),
      thenSteps: v.optional(v.array(v.any())),
      elseSteps: v.optional(v.array(v.any())),
    })
  ),
  isActive: v.boolean(),
  isSystem: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_slug", ["workspaceId", "slug"])
  .index("by_workspace_active", ["workspaceId", "isActive"]);

const actionExecutions = defineTable({
  workspaceId: v.id("workspaces"),
  actionId: v.id("actions"),
  triggeredBy: v.union(
    v.literal("manual"),
    v.literal("automatic"),
    v.literal("scheduled")
  ),
  triggerRecordId: v.optional(v.id("records")),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled")
  ),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  stepResults: v.array(
    v.object({
      stepId: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("skipped")
      ),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      input: v.optional(v.any()),
      output: v.optional(v.any()),
      error: v.optional(v.string()),
    })
  ),
  error: v.optional(v.string()),
  initiatorId: v.optional(v.id("workspaceMembers")),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_action", ["actionId"])
  .index("by_status", ["status"])
  .index("by_workspace_started", ["workspaceId", "startedAt"]);

// ============================================================================
// API KEYS & WEBHOOKS
// ============================================================================

const apiKeys = defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  keyHash: v.string(),
  keyPrefix: v.string(),
  permissions: v.array(v.string()),
  expiresAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  createdBy: v.id("workspaceMembers"),
  createdAt: v.number(),
  isActive: v.boolean(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_key_prefix", ["keyPrefix"]);

const webhookEndpoints = defineTable({
  workspaceId: v.id("workspaces"),
  name: v.string(),
  url: v.string(),
  secret: v.string(),
  events: v.array(v.string()),
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_active", ["workspaceId", "isActive"]);

// ============================================================================
// VIEWS & SAVED FILTERS
// ============================================================================

const views = defineTable({
  workspaceId: v.id("workspaces"),
  objectTypeId: v.optional(v.id("objectTypes")),
  listId: v.optional(v.id("lists")),
  name: v.string(),
  slug: v.string(),
  isDefault: v.boolean(),
  isPublic: v.boolean(),
  createdBy: v.id("workspaceMembers"),
  config: v.object({
    columns: v.array(
      v.object({
        attributeSlug: v.string(),
        width: v.optional(v.number()),
        sortOrder: v.number(),
      })
    ),
    sort: v.optional(
      v.array(
        v.object({
          field: v.string(),
          direction: v.union(v.literal("asc"), v.literal("desc")),
        })
      )
    ),
    filters: v.optional(
      v.array(
        v.object({
          field: v.string(),
          operator: v.string(),
          value: v.any(),
          logic: v.optional(v.union(v.literal("and"), v.literal("or"))),
        })
      )
    ),
    groupBy: v.optional(v.string()),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace", ["workspaceId"])
  .index("by_object_type", ["objectTypeId"])
  .index("by_list", ["listId"])
  .index("by_creator", ["createdBy"]);

// ============================================================================
// SCHEMA EXPORT
// ============================================================================

export default defineSchema({
  // Multi-tenancy
  workspaces,
  workspaceMembers,

  // Dynamic schema
  objectTypes,
  attributes,

  // Data
  records,

  // Bulk import
  bulkValidationSessions,

  // Lists (many-to-many)
  lists,
  listAttributes,
  listEntries,

  // Audit
  auditLogs,

  // Actions
  actions,
  actionExecutions,

  // API & Webhooks
  apiKeys,
  webhookEndpoints,

  // Views
  views,
});
