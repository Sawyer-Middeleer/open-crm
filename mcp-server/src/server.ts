import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConvexClient } from "./convex/client.js";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { validateUrl, validateUrlPattern } from "./lib/validation.js";
import { getRequiredScope, hasScope, AuthError } from "./auth/index.js";
import {
  validateRecordId,
  validateSessionId,
  validateWebhookId,
  validateTemplateId,
  validateWorkspaceId,
  validateOptionalConvexId,
} from "./lib/validators.js";

export type McpServerWrapper = ReturnType<typeof createServer>;

/**
 * Extract auth context from MCP tool extra parameter
 */
interface AuthContextFromExtra {
  userId: Id<"users">;
  email?: string;
  workspaceId: Id<"workspaces">;
  workspaceMemberId: Id<"workspaceMembers">;
  role: "owner" | "admin" | "member" | "viewer";
  authMethod: "oauth";
  provider?: string;
  scopes: string[];
}

/**
 * Extract and validate auth context for a tool call
 * Checks that the token has the required scope for the tool
 */
function getAuthContext(extra: unknown, toolName: string): AuthContextFromExtra {
  const authInfo = (extra as Record<string, unknown>)?.authInfo as
    | Record<string, unknown>
    | undefined;
  const data = authInfo?.extra as Record<string, unknown> | undefined;

  if (
    !data?.userId ||
    !data?.workspaceId ||
    !data?.workspaceMemberId ||
    !data?.role
  ) {
    throw new Error("Invalid auth context: missing required fields");
  }

  // Extract scopes from authInfo (set by http.ts from OAuth token)
  const scopes = (authInfo?.scopes as string[]) ?? [];

  // Check if token has required scope for this tool
  const requiredScope = getRequiredScope(toolName);
  if (!hasScope(scopes, requiredScope)) {
    throw new AuthError(
      `Insufficient scope: ${toolName} requires ${requiredScope}`,
      403,
      "scope-check",
      "insufficient_scope"
    );
  }

  return {
    userId: data.userId as Id<"users">,
    workspaceId: data.workspaceId as Id<"workspaces">,
    workspaceMemberId: data.workspaceMemberId as Id<"workspaceMembers">,
    role: data.role as "owner" | "admin" | "member" | "viewer",
    authMethod: "oauth",
    email: data.email as string | undefined,
    provider: data.provider as string | undefined,
    scopes,
  };
}

/**
 * Helper to format tool response with consistent JSON structure
 */
function jsonResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function createServer() {
  const server = new McpServer({
    name: "agent-crm",
    version: "0.1.0",
  });

  const convex = getConvexClient();

  // ============================================================================
  // RECORD TOOLS
  // ============================================================================

  server.tool(
    "records.create",
    "Create a new record of any object type",
    {
      objectType: z
        .string()
        .describe("Object type slug (e.g., 'people', 'companies', 'deals')"),
      data: z
        .record(z.any())
        .describe("Record data keyed by attribute slug"),
    },
    async ({ objectType, data }, extra) => {
      const auth = getAuthContext(extra, "records.create");
      const result = await convex.mutation(api.functions.records.mutations.create, {
        workspaceId: auth.workspaceId,
        objectTypeSlug: objectType,
        data,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.get",
    "Get a single record by ID",
    {
      recordId: z.string().describe("Record ID"),
    },
    async ({ recordId }, extra) => {
      const auth = getAuthContext(extra, "records.get");
      validateRecordId(recordId);
      const result = await convex.query(api.functions.records.queries.get, {
        workspaceId: auth.workspaceId,
        recordId: recordId as any,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.list",
    "List records of a specific object type with cursor-based pagination",
    {
      objectType: z.string().describe("Object type slug"),
      numItems: z.number().optional().describe("Number of records per page (default: 50)"),
      cursor: z.string().nullable().optional().describe("Pagination cursor from previous response"),
    },
    async ({ objectType, numItems, cursor }, extra) => {
      const auth = getAuthContext(extra, "records.list");
      const result = await convex.query(api.functions.records.queries.list, {
        workspaceId: auth.workspaceId,
        objectTypeSlug: objectType,
        paginationOpts: {
          numItems: numItems ?? 50,
          cursor: cursor ?? null,
        },
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.update",
    "Update an existing record",
    {
      recordId: z.string().describe("Record ID"),
      data: z.record(z.any()).describe("Fields to update"),
    },
    async ({ recordId, data }, extra) => {
      const auth = getAuthContext(extra, "records.update");
      validateRecordId(recordId);
      const result = await convex.mutation(api.functions.records.mutations.update, {
        workspaceId: auth.workspaceId,
        recordId: recordId as any,
        data,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.delete",
    "Delete a record",
    {
      recordId: z.string().describe("Record ID"),
    },
    async ({ recordId }, extra) => {
      const auth = getAuthContext(extra, "records.delete");
      validateRecordId(recordId);
      const result = await convex.mutation(api.functions.records.mutations.remove, {
        workspaceId: auth.workspaceId,
        recordId: recordId as any,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.search",
    "Search and filter records by field values. Supports filtering by any attribute with operators like equals, contains, greaterThan, etc. Uses cursor-based pagination with safety limits.",
    {
      objectType: z.string().optional().describe("Object type slug to filter by (e.g., 'people', 'deals')"),
      filters: z
        .array(
          z.object({
            field: z.string().describe("Attribute slug to filter on"),
            operator: z
              .enum([
                "equals",
                "notEquals",
                "contains",
                "notContains",
                "greaterThan",
                "lessThan",
                "greaterThanOrEquals",
                "lessThanOrEquals",
                "isEmpty",
                "isNotEmpty",
                "in",
                "notIn",
              ])
              .describe("Filter operator"),
            value: z.any().optional().describe("Value to compare against"),
          })
        )
        .optional()
        .describe("Array of filters to apply (combined with AND)"),
      query: z.string().optional().describe("Text search across displayName and text fields"),
      sortBy: z.string().optional().describe("Attribute slug to sort by, or '_createdAt'"),
      sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort order (default: asc)"),
      numItems: z.number().optional().describe("Number of records per page (default: 50)"),
      cursor: z.string().nullable().optional().describe("Pagination cursor from previous response"),
    },
    async ({ objectType, filters, query, sortBy, sortOrder, numItems, cursor }, extra) => {
      const auth = getAuthContext(extra, "records.search");
      const result = await convex.query(api.functions.records.queries.search, {
        workspaceId: auth.workspaceId,
        objectTypeSlug: objectType,
        filters,
        query,
        sortBy,
        sortOrder,
        paginationOpts: {
          numItems: numItems ?? 50,
          cursor: cursor ?? null,
        },
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.getRelated",
    "Get all records related to a given record via references or list memberships. Returns outbound references (this record points to), inbound references (other records point to this), and list relationships.",
    {
      recordId: z.string().describe("Record ID to get relationships for"),
      relationship: z
        .string()
        .optional()
        .describe("Filter to specific relationship (attribute slug or list slug)"),
    },
    async ({ recordId, relationship }, extra) => {
      const auth = getAuthContext(extra, "records.getRelated");
      validateRecordId(recordId);
      const result = await convex.query(api.functions.records.queries.getRelated, {
        workspaceId: auth.workspaceId,
        recordId: recordId as any,
        relationship,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // BULK IMPORT TOOLS
  // ============================================================================

  server.tool(
    "records.bulkValidate",
    "Validate an array of records before import. Returns a token-efficient summary with error counts and sample failures. Use the returned sessionId with bulkCommit to insert valid records.",
    {
      objectType: z.string().describe("Object type slug (e.g., 'people')"),
      records: z
        .array(
          z.object({
            data: z.record(z.any()).describe("Record data keyed by attribute slug"),
            externalId: z
              .string()
              .optional()
              .describe("Optional external ID for tracking"),
          })
        )
        .describe("Array of records to validate"),
    },
    async ({ objectType, records }, extra) => {
      const auth = getAuthContext(extra, "records.bulkValidate");
      const result = await convex.mutation(api.functions.records.mutations.bulkValidate, {
        workspaceId: auth.workspaceId,
        objectTypeSlug: objectType,
        records,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.bulkCommit",
    "Commit validated records from a bulkValidate session. Use mode 'validOnly' to skip invalid records, or 'all' to attempt inserting everything.",
    {
      sessionId: z.string().describe("Session ID from bulkValidate"),
      mode: z
        .enum(["validOnly", "all"])
        .default("validOnly")
        .describe("'validOnly' skips invalid records, 'all' attempts everything"),
    },
    async ({ sessionId, mode }, extra) => {
      const auth = getAuthContext(extra, "records.bulkCommit");
      validateSessionId(sessionId);
      const result = await convex.mutation(api.functions.records.mutations.bulkCommit, {
        workspaceId: auth.workspaceId,
        sessionId: sessionId as any,
        mode,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "records.bulkInspect",
    "Inspect specific records from a validation session. Use this to see full details of invalid records before deciding how to proceed.",
    {
      sessionId: z.string().describe("Session ID from bulkValidate"),
      indices: z
        .array(z.number())
        .describe("Array of record indices to inspect (0-based)"),
    },
    async ({ sessionId, indices }, extra) => {
      const auth = getAuthContext(extra, "records.bulkInspect");
      validateSessionId(sessionId);
      const result = await convex.query(api.functions.records.queries.bulkInspect, {
        workspaceId: auth.workspaceId,
        sessionId: sessionId as any,
        indices,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // SCHEMA TOOLS
  // ============================================================================

  server.tool(
    "schema.objectTypes.list",
    "List all object types in the workspace",
    {},
    async (_args, extra) => {
      const auth = getAuthContext(extra, "schema.objectTypes.list");
      const result = await convex.query(api.functions.objectTypes.queries.list, {
        workspaceId: auth.workspaceId,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "schema.objectTypes.get",
    "Get an object type with its attributes",
    {
      objectType: z.string().describe("Object type slug"),
    },
    async ({ objectType }, extra) => {
      const auth = getAuthContext(extra, "schema.objectTypes.get");
      const result = await convex.query(api.functions.objectTypes.queries.getWithAttributes, {
        workspaceId: auth.workspaceId,
        slug: objectType,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "schema.objectTypes.create",
    "Create a new custom object type",
    {
      name: z.string().describe("Display name (e.g., 'Projects')"),
      singularName: z.string().describe("Singular form (e.g., 'Project')"),
      slug: z.string().describe("URL-safe identifier (e.g., 'projects')"),
      description: z.string().optional().describe("Description of the object type"),
    },
    async ({ name, singularName, slug, description }, extra) => {
      const auth = getAuthContext(extra, "schema.objectTypes.create");
      const result = await convex.mutation(api.functions.objectTypes.mutations.create, {
        workspaceId: auth.workspaceId,
        name,
        singularName,
        slug,
        description,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "schema.attributes.create",
    "Add an attribute to an object type",
    {
      objectType: z.string().describe("Object type slug"),
      name: z.string().describe("Display name"),
      slug: z.string().describe("Attribute identifier"),
      type: z
        .enum([
          "text",
          "richText",
          "number",
          "currency",
          "date",
          "datetime",
          "boolean",
          "select",
          "multiSelect",
          "email",
          "phone",
          "url",
          "reference",
          "user",
          "file",
          "json",
        ])
        .describe("Attribute type"),
      isRequired: z.boolean().optional().describe("Whether this field is required"),
      config: z.record(z.any()).optional().describe("Type-specific configuration"),
    },
    async ({ objectType, name, slug, type, isRequired, config }, extra) => {
      const auth = getAuthContext(extra, "schema.attributes.create");
      const result = await convex.mutation(api.functions.attributes.mutations.create, {
        workspaceId: auth.workspaceId,
        objectTypeSlug: objectType,
        name,
        slug,
        type,
        isRequired: isRequired ?? false,
        config: config ?? {},
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // LIST TOOLS
  // ============================================================================

  server.tool(
    "lists.create",
    "Create a custom list (many-to-many relationship) with optional attributes",
    {
      name: z.string().describe("List display name (e.g., 'Team Members')"),
      slug: z.string().describe("URL-safe identifier (e.g., 'team_members')"),
      description: z.string().optional().describe("Description of what this list represents"),
      parentObjectType: z
        .string()
        .optional()
        .describe("Parent object type slug (e.g., 'companies' for a contacts list)"),
      allowedObjectTypes: z
        .array(z.string())
        .describe("Object type slugs that can be added to this list (e.g., ['people'])"),
      icon: z.string().optional().describe("Icon identifier"),
      attributes: z
        .array(
          z.object({
            name: z.string().describe("Attribute display name"),
            slug: z.string().describe("Attribute identifier"),
            type: z
              .enum([
                "text",
                "richText",
                "number",
                "currency",
                "date",
                "datetime",
                "boolean",
                "select",
                "multiSelect",
                "email",
                "phone",
                "url",
                "reference",
                "user",
                "file",
                "json",
              ])
              .describe("Attribute type"),
            isRequired: z.boolean().optional().describe("Whether this field is required"),
            config: z.record(z.any()).optional().describe("Type-specific configuration"),
          })
        )
        .optional()
        .describe("Custom attributes for list entries"),
    },
    async ({ name, slug, description, parentObjectType, allowedObjectTypes, icon, attributes }, extra) => {
      const auth = getAuthContext(extra, "lists.create");
      const result = await convex.mutation(api.functions.lists.mutations.create, {
        workspaceId: auth.workspaceId,
        name,
        slug,
        description,
        parentObjectType,
        allowedObjectTypes,
        icon,
        attributes,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "lists.getEntries",
    "Get entries from a list, optionally filtered by parent record",
    {
      listSlug: z.string().describe("List slug"),
      parentRecordId: z.string().optional().describe("Filter by parent record ID"),
    },
    async ({ listSlug, parentRecordId }, extra) => {
      const auth = getAuthContext(extra, "lists.getEntries");
      validateOptionalConvexId(parentRecordId, "parentRecordId");
      const result = await convex.query(api.functions.lists.queries.getEntries, {
        workspaceId: auth.workspaceId,
        listSlug,
        parentRecordId: parentRecordId as any,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "lists.addEntry",
    "Add a record to a list",
    {
      listSlug: z.string().describe("List slug"),
      recordId: z.string().describe("Record to add"),
      parentRecordId: z.string().optional().describe("Parent record (for scoped lists)"),
      data: z.record(z.any()).optional().describe("List entry attribute values"),
    },
    async ({ listSlug, recordId, parentRecordId, data }, extra) => {
      const auth = getAuthContext(extra, "lists.addEntry");
      validateRecordId(recordId);
      validateOptionalConvexId(parentRecordId, "parentRecordId");
      const result = await convex.mutation(api.functions.lists.mutations.addEntry, {
        workspaceId: auth.workspaceId,
        listSlug,
        recordId: recordId as any,
        parentRecordId: parentRecordId as any,
        data: data ?? {},
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "lists.removeEntry",
    "Remove a record from a list",
    {
      listSlug: z.string().describe("List slug"),
      recordId: z.string().describe("Record to remove"),
      parentRecordId: z.string().optional().describe("Parent record (for scoped lists)"),
    },
    async ({ listSlug, recordId, parentRecordId }, extra) => {
      const auth = getAuthContext(extra, "lists.removeEntry");
      validateRecordId(recordId);
      validateOptionalConvexId(parentRecordId, "parentRecordId");
      const result = await convex.mutation(api.functions.lists.mutations.removeEntry, {
        workspaceId: auth.workspaceId,
        listSlug,
        recordId: recordId as any,
        parentRecordId: parentRecordId as any,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // WORKSPACE TOOLS
  // ============================================================================

  server.tool(
    "workspace.create",
    "Create a new workspace with default object types (People, Companies, Deals). Uses the authenticated user as the owner.",
    {
      name: z.string().describe("Workspace display name"),
      slug: z.string().describe("URL-safe identifier (must be unique)"),
    },
    async ({ name, slug }, extra) => {
      const auth = getAuthContext(extra, "workspace.create");
      const result = await convex.mutation(api.functions.workspaces.mutations.create, {
        name,
        slug,
        userId: auth.userId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // AUDIT TOOLS
  // ============================================================================

  server.tool(
    "audit.getHistory",
    "Get audit history for a specific record",
    {
      recordId: z.string().describe("Record ID to get history for"),
      limit: z.number().optional().describe("Maximum entries to return"),
    },
    async ({ recordId, limit }, extra) => {
      const auth = getAuthContext(extra, "audit.getHistory");
      validateRecordId(recordId);
      const result = await convex.query(api.functions.audit.queries.getRecordHistory, {
        workspaceId: auth.workspaceId,
        recordId: recordId as any,
        limit,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // ACTION TOOLS
  // ============================================================================

  server.tool(
    "actions.execute",
    "Execute a custom action on a record",
    {
      actionSlug: z.string().describe("Action slug"),
      recordId: z.string().describe("Record to execute action on"),
    },
    async ({ actionSlug, recordId }, extra) => {
      const auth = getAuthContext(extra, "actions.execute");
      validateRecordId(recordId);
      const result = await convex.mutation(api.functions.actions.mutations.execute, {
        workspaceId: auth.workspaceId,
        actionSlug,
        recordId: recordId as any,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "actions.list",
    "List available actions for an object type",
    {
      objectType: z.string().optional().describe("Filter by object type slug"),
    },
    async ({ objectType }, extra) => {
      const auth = getAuthContext(extra, "actions.list");
      const result = await convex.query(api.functions.actions.queries.list, {
        workspaceId: auth.workspaceId,
        objectTypeSlug: objectType,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  const stepSchema = z.object({
    id: z.string().describe("Unique step identifier"),
    type: z.enum([
      "updateField",
      "clearField",
      "copyField",
      "transformField",
      "createRecord",
      "deleteRecord",
      "archiveRecord",
      "addToList",
      "removeFromList",
      "updateListEntry",
      "sendWebhook",
      "condition",
      "loop",
      "callMcpTool",
    ]).describe("Step type"),
    name: z.string().optional().describe("Human-readable step name"),
    config: z.record(z.any()).describe("Step configuration (varies by type)"),
    thenSteps: z.array(z.any()).optional().describe("Steps to run if condition passes"),
    elseSteps: z.array(z.any()).optional().describe("Steps to run if condition fails"),
    steps: z.array(z.any()).optional().describe("Steps to run in loop"),
  });

  server.tool(
    "actions.create",
    `Create an automation action with triggers, conditions, and steps.

Step Types:
- updateField: { field, value }
- clearField: { field }
- copyField: { sourceField, targetField }
- transformField: { field, transform: "uppercase"|"lowercase"|"trim"|"round"|"increment"|"decrement", amount? }
- createRecord: { objectType, data }
- deleteRecord: { recordId?, useTriggeredRecord? }
- archiveRecord: { recordId?, useTriggeredRecord? }
- addToList: { list, recordId?, parentRecordId?, data? }
- removeFromList: { list, recordId?, parentRecordId? }
- updateListEntry: { list, recordId?, parentRecordId?, data }
- sendWebhook: { url, method, headers?, body? }
- condition: { conditions: [{field, operator, value}], logic: "and"|"or" } + thenSteps/elseSteps
- loop: { source: "records"|"array"|"field", objectType?, filters?, items?, field?, maxIterations? } + steps
- callMcpTool: { tool, arguments }

Variable interpolation: Use {{record.field}}, {{previous.output}}, {{loopItem}}, {{loopIndex}} in config values.`,
    {
      name: z.string().describe("Action name"),
      slug: z.string().describe("Unique action slug"),
      description: z.string().optional().describe("Action description"),
      trigger: z.object({
        type: z.enum([
          "manual",
          "onCreate",
          "onUpdate",
          "onDelete",
          "onFieldChange",
          "onListAdd",
          "onListRemove",
          "scheduled",
        ]).describe("When the action triggers"),
        objectType: z.string().optional().describe("Object type slug (for record triggers)"),
        list: z.string().optional().describe("List slug (for list triggers)"),
        watchedFields: z.array(z.string()).optional().describe("Fields to watch (for onFieldChange)"),
        schedule: z.string().optional().describe("Cron expression (for scheduled)"),
      }),
      conditions: z.array(z.object({
        field: z.string(),
        operator: z.enum([
          "equals",
          "notEquals",
          "contains",
          "notContains",
          "greaterThan",
          "lessThan",
          "isEmpty",
          "isNotEmpty",
          "in",
          "notIn",
        ]),
        value: z.any(),
        logic: z.enum(["and", "or"]).optional(),
      })).optional().describe("Conditions that must pass for action to run"),
      steps: z.array(stepSchema).describe("Action steps to execute"),
      isActive: z.boolean().optional().default(true).describe("Whether action is active"),
    },
    async (args, extra) => {
      const auth = getAuthContext(extra, "actions.create");
      const result = await convex.mutation(api.functions.actions.mutations.createWithSlugs, {
        workspaceId: auth.workspaceId,
        name: args.name,
        slug: args.slug,
        description: args.description,
        trigger: args.trigger,
        conditions: args.conditions as any,
        steps: args.steps as any,
        isActive: args.isActive,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // INTEGRATION TOOLS
  // ============================================================================

  server.tool(
    "integrations.createWebhookEndpoint",
    `Create an incoming webhook endpoint that external services can POST to.
Returns a URL and secret. The secret is only shown once - save it for signature verification.
Handler types:
- createRecord: Creates a new record using field mapping from payload
- triggerAction: Triggers an action with the webhook payload as context`,
    {
      name: z.string().describe("Webhook name"),
      slug: z.string().describe("URL slug (used in webhook URL path)"),
      description: z.string().optional().describe("Webhook description"),
      handlerType: z.enum(["createRecord", "triggerAction"]).describe("What to do with the webhook payload"),
      objectType: z.string().optional().describe("Object type slug (for createRecord handler)"),
      fieldMapping: z.record(z.string()).optional().describe("Map payload paths to field slugs, e.g. {'data.email': 'email'}"),
      actionSlug: z.string().optional().describe("Action slug (for triggerAction handler)"),
    },
    async (args, extra) => {
      const auth = getAuthContext(extra, "integrations.createWebhookEndpoint");
      const result = await convex.mutation(api.functions.integrations.mutations.createIncomingWebhook, {
        workspaceId: auth.workspaceId,
        name: args.name,
        slug: args.slug,
        description: args.description,
        handler: {
          type: args.handlerType,
          objectType: args.objectType,
          fieldMapping: args.fieldMapping,
          actionSlug: args.actionSlug,
        },
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "integrations.listWebhookEndpoints",
    "List all incoming webhook endpoints for a workspace",
    {
      includeInactive: z.boolean().optional().describe("Include disabled webhooks"),
    },
    async ({ includeInactive }, extra) => {
      const auth = getAuthContext(extra, "integrations.listWebhookEndpoints");
      const result = await convex.query(api.functions.integrations.queries.listIncomingWebhooks, {
        workspaceId: auth.workspaceId,
        includeInactive,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "integrations.getWebhookLogs",
    "Get logs of received webhook requests",
    {
      webhookId: z.string().optional().describe("Filter by specific webhook ID"),
      limit: z.number().optional().describe("Maximum number of logs to return (default 50)"),
    },
    async ({ webhookId, limit }, extra) => {
      const auth = getAuthContext(extra, "integrations.getWebhookLogs");
      if (webhookId) {
        validateWebhookId(webhookId);
      }
      const result = await convex.query(api.functions.integrations.queries.getWebhookLogs, {
        workspaceId: auth.workspaceId,
        webhookId: webhookId as any,
        limit,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "integrations.createTemplate",
    `Create a reusable HTTP request template.
Templates can use {{variable}} placeholders in URL, headers, and body.
Auth credentials are stored as environment variable NAMES (not values).`,
    {
      name: z.string().describe("Template name"),
      slug: z.string().describe("Unique template slug"),
      description: z.string().optional().describe("Template description"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method"),
      url: z.string().describe("Request URL (can include {{variable}} placeholders)"),
      headers: z.record(z.string()).optional().describe("Request headers"),
      body: z.any().optional().describe("Request body (can include {{variable}} placeholders)"),
      auth: z.object({
        type: z.enum(["none", "bearer", "basic", "apiKey"]).describe("Auth type"),
        tokenEnvVar: z.string().optional().describe("Env var name containing bearer token"),
        usernameEnvVar: z.string().optional().describe("Env var name containing username"),
        passwordEnvVar: z.string().optional().describe("Env var name containing password"),
        headerName: z.string().optional().describe("Header name for API key (default: X-API-Key)"),
        keyEnvVar: z.string().optional().describe("Env var name containing API key"),
      }).optional().describe("Authentication configuration"),
    },
    async (args, extra) => {
      const auth = getAuthContext(extra, "integrations.createTemplate");

      // Validate URL pattern to prevent SSRF (handles both static URLs and templates with variables)
      const urlValidation = validateUrlPattern(args.url);
      if (!urlValidation.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: urlValidation.error }, null, 2),
            },
          ],
        };
      }

      const result = await convex.mutation(api.functions.integrations.mutations.createHttpTemplate, {
        workspaceId: auth.workspaceId,
        name: args.name,
        slug: args.slug,
        description: args.description,
        method: args.method,
        url: args.url,
        headers: args.headers,
        body: args.body,
        auth: args.auth,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "integrations.listTemplates",
    "List all HTTP request templates for a workspace",
    {},
    async (_args, extra) => {
      const auth = getAuthContext(extra, "integrations.listTemplates");
      const result = await convex.query(api.functions.integrations.queries.listHttpTemplates, {
        workspaceId: auth.workspaceId,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "integrations.sendRequest",
    `Send an HTTP request directly or using a template.
Use either url/method/headers/body for ad-hoc requests, or templateSlug with variables.`,
    {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("HTTP method (if not using template)"),
      url: z.string().optional().describe("Request URL (if not using template)"),
      headers: z.record(z.string()).optional().describe("Request headers"),
      body: z.any().optional().describe("Request body"),
      authConfig: z.object({
        type: z.string(),
        tokenEnvVar: z.string().optional(),
        usernameEnvVar: z.string().optional(),
        passwordEnvVar: z.string().optional(),
        headerName: z.string().optional(),
        keyEnvVar: z.string().optional(),
      }).optional().describe("Auth config (if not using template)"),
    },
    async (args, extra) => {
      const auth = getAuthContext(extra, "integrations.sendRequest");
      if (!args.url || !args.method) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Either url+method or templateSlug is required" }, null, 2),
            },
          ],
        };
      }

      // Validate URL to prevent SSRF
      const urlValidation = validateUrl(args.url);
      if (!urlValidation.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: urlValidation.error }, null, 2),
            },
          ],
        };
      }

      const result = await convex.action(api.functions.integrations.httpActions.sendRequest, {
        workspaceId: auth.workspaceId,
        method: args.method,
        url: args.url,
        headers: args.headers,
        body: args.body,
        authConfig: args.authConfig,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  server.tool(
    "integrations.getRequestLogs",
    "Get logs of outgoing HTTP requests",
    {
      templateId: z.string().optional().describe("Filter by template ID"),
      limit: z.number().optional().describe("Maximum number of logs to return (default 50)"),
    },
    async ({ templateId, limit }, extra) => {
      const auth = getAuthContext(extra, "integrations.getRequestLogs");
      if (templateId) {
        validateTemplateId(templateId);
      }
      const result = await convex.query(api.functions.integrations.queries.getHttpRequestLogs, {
        workspaceId: auth.workspaceId,
        templateId: templateId as any,
        limit,
        actorId: auth.workspaceMemberId,
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // USER TOOLS
  // ============================================================================

  server.tool(
    "users.me",
    "Get the currently authenticated user's information including their workspaces",
    {},
    async (_args, extra) => {
      const auth = getAuthContext(extra, "users.me");
      const [user, workspaces] = await Promise.all([
        convex.query(api.functions.auth.queries.getUser, {
          userId: auth.userId,
        }),
        convex.query(api.functions.auth.queries.listUserWorkspaces, {
          userId: auth.userId,
        }),
      ]);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ user, workspaces }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "users.updatePreferences",
    "Update the current user's preferences",
    {
      defaultWorkspaceId: z.string().optional().describe("Default workspace ID"),
      timezone: z.string().optional().describe("User's timezone (e.g., 'America/New_York')"),
    },
    async ({ defaultWorkspaceId, timezone }, extra) => {
      const auth = getAuthContext(extra, "users.updatePreferences");
      if (defaultWorkspaceId) {
        validateWorkspaceId(defaultWorkspaceId);
      }
      const result = await convex.mutation(api.functions.auth.mutations.updateUserPreferences, {
        userId: auth.userId,
        preferences: {
          defaultWorkspaceId: defaultWorkspaceId as any,
          timezone,
        },
      });
      return jsonResponse(result);
    }
  );

  // ============================================================================
  // RETURN SERVER
  // ============================================================================

  return {
    server,
    convex,
  };
}
