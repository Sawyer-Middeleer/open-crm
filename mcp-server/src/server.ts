import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getConvexClient } from "./convex/client.js";
import { api } from "../../convex/_generated/api.js";

export function createServer() {
  const server = new McpServer({
    name: "massive-crm",
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
      workspaceId: z.string().describe("Workspace ID"),
      objectType: z
        .string()
        .describe("Object type slug (e.g., 'people', 'companies', 'deals')"),
      data: z
        .record(z.any())
        .describe("Record data keyed by attribute slug"),
      actorId: z.string().describe("ID of the workspace member creating this record"),
    },
    async ({ workspaceId, objectType, data, actorId }) => {
      const result = await convex.mutation(api.functions.records.mutations.create, {
        workspaceId: workspaceId as any,
        objectTypeSlug: objectType,
        data,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.get",
    "Get a single record by ID",
    {
      workspaceId: z.string().describe("Workspace ID"),
      recordId: z.string().describe("Record ID"),
    },
    async ({ workspaceId, recordId }) => {
      const result = await convex.query(api.functions.records.queries.get, {
        workspaceId: workspaceId as any,
        recordId: recordId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.list",
    "List records of a specific object type",
    {
      workspaceId: z.string().describe("Workspace ID"),
      objectType: z.string().describe("Object type slug"),
      limit: z.number().optional().describe("Maximum number of records to return"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ workspaceId, objectType, limit, cursor }) => {
      const result = await convex.query(api.functions.records.queries.list, {
        workspaceId: workspaceId as any,
        objectTypeSlug: objectType,
        limit,
        cursor,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.update",
    "Update an existing record",
    {
      workspaceId: z.string().describe("Workspace ID"),
      recordId: z.string().describe("Record ID"),
      data: z.record(z.any()).describe("Fields to update"),
      actorId: z.string().describe("ID of the workspace member updating this record"),
    },
    async ({ workspaceId, recordId, data, actorId }) => {
      const result = await convex.mutation(api.functions.records.mutations.update, {
        workspaceId: workspaceId as any,
        recordId: recordId as any,
        data,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.delete",
    "Delete a record",
    {
      workspaceId: z.string().describe("Workspace ID"),
      recordId: z.string().describe("Record ID"),
      actorId: z.string().describe("ID of the workspace member deleting this record"),
    },
    async ({ workspaceId, recordId, actorId }) => {
      const result = await convex.mutation(api.functions.records.mutations.remove, {
        workspaceId: workspaceId as any,
        recordId: recordId as any,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.search",
    "Search and filter records by field values. Supports filtering by any attribute with operators like equals, contains, greaterThan, etc.",
    {
      workspaceId: z.string().describe("Workspace ID"),
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
      limit: z.number().optional().describe("Maximum number of records to return (default: 50)"),
    },
    async ({ workspaceId, objectType, filters, query, sortBy, sortOrder, limit }) => {
      const result = await convex.query(api.functions.records.queries.search, {
        workspaceId: workspaceId as any,
        objectTypeSlug: objectType,
        filters,
        query,
        sortBy,
        sortOrder,
        limit,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.getRelated",
    "Get all records related to a given record via references or list memberships. Returns outbound references (this record points to), inbound references (other records point to this), and list relationships.",
    {
      workspaceId: z.string().describe("Workspace ID"),
      recordId: z.string().describe("Record ID to get relationships for"),
      relationship: z
        .string()
        .optional()
        .describe("Filter to specific relationship (attribute slug or list slug)"),
    },
    async ({ workspaceId, recordId, relationship }) => {
      const result = await convex.query(api.functions.records.queries.getRelated, {
        workspaceId: workspaceId as any,
        recordId: recordId as any,
        relationship,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // BULK IMPORT TOOLS
  // ============================================================================

  server.tool(
    "records.bulkValidate",
    "Validate an array of records before import. Returns a token-efficient summary with error counts and sample failures. Use the returned sessionId with bulkCommit to insert valid records.",
    {
      workspaceId: z.string().describe("Workspace ID"),
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
      actorId: z.string().describe("ID of the workspace member performing the import"),
    },
    async ({ workspaceId, objectType, records, actorId }) => {
      const result = await convex.mutation(api.functions.records.mutations.bulkValidate, {
        workspaceId: workspaceId as any,
        objectTypeSlug: objectType,
        records,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.bulkCommit",
    "Commit validated records from a bulkValidate session. Use mode 'validOnly' to skip invalid records, or 'all' to attempt inserting everything.",
    {
      workspaceId: z.string().describe("Workspace ID"),
      sessionId: z.string().describe("Session ID from bulkValidate"),
      mode: z
        .enum(["validOnly", "all"])
        .default("validOnly")
        .describe("'validOnly' skips invalid records, 'all' attempts everything"),
      actorId: z.string().describe("ID of the workspace member performing the import"),
    },
    async ({ workspaceId, sessionId, mode, actorId }) => {
      const result = await convex.mutation(api.functions.records.mutations.bulkCommit, {
        workspaceId: workspaceId as any,
        sessionId: sessionId as any,
        mode,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "records.bulkInspect",
    "Inspect specific records from a validation session. Use this to see full details of invalid records before deciding how to proceed.",
    {
      workspaceId: z.string().describe("Workspace ID"),
      sessionId: z.string().describe("Session ID from bulkValidate"),
      indices: z
        .array(z.number())
        .describe("Array of record indices to inspect (0-based)"),
    },
    async ({ workspaceId, sessionId, indices }) => {
      const result = await convex.query(api.functions.records.queries.bulkInspect, {
        workspaceId: workspaceId as any,
        sessionId: sessionId as any,
        indices,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // SCHEMA TOOLS
  // ============================================================================

  server.tool(
    "schema.objectTypes.list",
    "List all object types in a workspace",
    {
      workspaceId: z.string().describe("Workspace ID"),
    },
    async ({ workspaceId }) => {
      const result = await convex.query(api.functions.objectTypes.queries.list, {
        workspaceId: workspaceId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "schema.objectTypes.get",
    "Get an object type with its attributes",
    {
      workspaceId: z.string().describe("Workspace ID"),
      objectType: z.string().describe("Object type slug"),
    },
    async ({ workspaceId, objectType }) => {
      const result = await convex.query(api.functions.objectTypes.queries.getWithAttributes, {
        workspaceId: workspaceId as any,
        slug: objectType,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "schema.objectTypes.create",
    "Create a new custom object type",
    {
      workspaceId: z.string().describe("Workspace ID"),
      name: z.string().describe("Display name (e.g., 'Projects')"),
      singularName: z.string().describe("Singular form (e.g., 'Project')"),
      slug: z.string().describe("URL-safe identifier (e.g., 'projects')"),
      description: z.string().optional().describe("Description of the object type"),
      actorId: z.string().describe("ID of the workspace member creating this"),
    },
    async ({ workspaceId, name, singularName, slug, description, actorId }) => {
      const result = await convex.mutation(api.functions.objectTypes.mutations.create, {
        workspaceId: workspaceId as any,
        name,
        singularName,
        slug,
        description,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "schema.attributes.create",
    "Add an attribute to an object type",
    {
      workspaceId: z.string().describe("Workspace ID"),
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
      actorId: z.string().describe("ID of the workspace member creating this"),
    },
    async ({
      workspaceId,
      objectType,
      name,
      slug,
      type,
      isRequired,
      config,
      actorId,
    }) => {
      const result = await convex.mutation(api.functions.attributes.mutations.create, {
        workspaceId: workspaceId as any,
        objectTypeSlug: objectType,
        name,
        slug,
        type,
        isRequired: isRequired ?? false,
        config: config ?? {},
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // LIST TOOLS
  // ============================================================================

  server.tool(
    "lists.create",
    "Create a custom list (many-to-many relationship) with optional attributes",
    {
      workspaceId: z.string().describe("Workspace ID"),
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
      actorId: z.string().describe("ID of the workspace member creating this list"),
    },
    async ({
      workspaceId,
      name,
      slug,
      description,
      parentObjectType,
      allowedObjectTypes,
      icon,
      attributes,
      actorId,
    }) => {
      const result = await convex.mutation(api.functions.lists.mutations.create, {
        workspaceId: workspaceId as any,
        name,
        slug,
        description,
        parentObjectType,
        allowedObjectTypes,
        icon,
        attributes,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "lists.getEntries",
    "Get entries from a list, optionally filtered by parent record",
    {
      workspaceId: z.string().describe("Workspace ID"),
      listSlug: z.string().describe("List slug"),
      parentRecordId: z.string().optional().describe("Filter by parent record ID"),
    },
    async ({ workspaceId, listSlug, parentRecordId }) => {
      const result = await convex.query(api.functions.lists.queries.getEntries, {
        workspaceId: workspaceId as any,
        listSlug,
        parentRecordId: parentRecordId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "lists.addEntry",
    "Add a record to a list",
    {
      workspaceId: z.string().describe("Workspace ID"),
      listSlug: z.string().describe("List slug"),
      recordId: z.string().describe("Record to add"),
      parentRecordId: z.string().optional().describe("Parent record (for scoped lists)"),
      data: z.record(z.any()).optional().describe("List entry attribute values"),
      actorId: z.string().describe("ID of the workspace member adding this entry"),
    },
    async ({ workspaceId, listSlug, recordId, parentRecordId, data, actorId }) => {
      const result = await convex.mutation(api.functions.lists.mutations.addEntry, {
        workspaceId: workspaceId as any,
        listSlug,
        recordId: recordId as any,
        parentRecordId: parentRecordId as any,
        data: data ?? {},
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "lists.removeEntry",
    "Remove a record from a list",
    {
      workspaceId: z.string().describe("Workspace ID"),
      listSlug: z.string().describe("List slug"),
      recordId: z.string().describe("Record to remove"),
      parentRecordId: z.string().optional().describe("Parent record (for scoped lists)"),
      actorId: z.string().describe("ID of the workspace member removing this entry"),
    },
    async ({ workspaceId, listSlug, recordId, parentRecordId, actorId }) => {
      const result = await convex.mutation(api.functions.lists.mutations.removeEntry, {
        workspaceId: workspaceId as any,
        listSlug,
        recordId: recordId as any,
        parentRecordId: parentRecordId as any,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // WORKSPACE TOOLS
  // ============================================================================

  server.tool(
    "workspace.create",
    "Create a new workspace with default object types (People, Companies, Deals)",
    {
      name: z.string().describe("Workspace display name"),
      slug: z.string().describe("URL-safe identifier (must be unique)"),
      ownerUserId: z.string().describe("External user ID for the owner"),
      ownerEmail: z.string().describe("Owner's email address"),
    },
    async ({ name, slug, ownerUserId, ownerEmail }) => {
      const result = await convex.mutation(api.functions.workspaces.mutations.create, {
        name,
        slug,
        ownerUserId,
        ownerEmail,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // AUDIT TOOLS
  // ============================================================================

  server.tool(
    "audit.getHistory",
    "Get audit history for a specific record",
    {
      workspaceId: z.string().describe("Workspace ID"),
      recordId: z.string().describe("Record ID to get history for"),
      limit: z.number().optional().describe("Maximum entries to return"),
    },
    async ({ workspaceId, recordId, limit }) => {
      const result = await convex.query(api.functions.audit.queries.getRecordHistory, {
        workspaceId: workspaceId as any,
        recordId: recordId as any,
        limit,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // ACTION TOOLS
  // ============================================================================

  server.tool(
    "actions.execute",
    "Execute a custom action on a record",
    {
      workspaceId: z.string().describe("Workspace ID"),
      actionSlug: z.string().describe("Action slug"),
      recordId: z.string().describe("Record to execute action on"),
      actorId: z.string().describe("ID of the workspace member executing this"),
    },
    async ({ workspaceId, actionSlug, recordId, actorId }) => {
      const result = await convex.mutation(api.functions.actions.mutations.execute, {
        workspaceId: workspaceId as any,
        actionSlug,
        recordId: recordId as any,
        actorId: actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "actions.list",
    "List available actions for an object type",
    {
      workspaceId: z.string().describe("Workspace ID"),
      objectType: z.string().optional().describe("Filter by object type slug"),
    },
    async ({ workspaceId, objectType }) => {
      const result = await convex.query(api.functions.actions.queries.list, {
        workspaceId: workspaceId as any,
        objectTypeSlug: objectType,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
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
      workspaceId: z.string().describe("Workspace ID"),
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
      actorId: z.string().describe("ID of the workspace member creating this"),
    },
    async (args) => {
      const result = await convex.mutation(api.functions.actions.mutations.createWithSlugs, {
        workspaceId: args.workspaceId as any,
        name: args.name,
        slug: args.slug,
        description: args.description,
        trigger: args.trigger,
        conditions: args.conditions as any,
        steps: args.steps as any,
        isActive: args.isActive,
        actorId: args.actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
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
      workspaceId: z.string().describe("Workspace ID"),
      name: z.string().describe("Webhook name"),
      slug: z.string().describe("URL slug (used in webhook URL path)"),
      description: z.string().optional().describe("Webhook description"),
      handlerType: z.enum(["createRecord", "triggerAction"]).describe("What to do with the webhook payload"),
      objectType: z.string().optional().describe("Object type slug (for createRecord handler)"),
      fieldMapping: z.record(z.string()).optional().describe("Map payload paths to field slugs, e.g. {'data.email': 'email'}"),
      actionSlug: z.string().optional().describe("Action slug (for triggerAction handler)"),
      actorId: z.string().describe("ID of the workspace member creating this"),
    },
    async (args) => {
      const result = await convex.mutation(api.functions.integrations.mutations.createIncomingWebhook, {
        workspaceId: args.workspaceId as any,
        name: args.name,
        slug: args.slug,
        description: args.description,
        handler: {
          type: args.handlerType,
          objectType: args.objectType,
          fieldMapping: args.fieldMapping,
          actionSlug: args.actionSlug,
        },
        actorId: args.actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "integrations.listWebhookEndpoints",
    "List all incoming webhook endpoints for a workspace",
    {
      workspaceId: z.string().describe("Workspace ID"),
      includeInactive: z.boolean().optional().describe("Include disabled webhooks"),
    },
    async ({ workspaceId, includeInactive }) => {
      const result = await convex.query(api.functions.integrations.queries.listIncomingWebhooks, {
        workspaceId: workspaceId as any,
        includeInactive,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "integrations.getWebhookLogs",
    "Get logs of received webhook requests",
    {
      workspaceId: z.string().describe("Workspace ID"),
      webhookId: z.string().optional().describe("Filter by specific webhook ID"),
      limit: z.number().optional().describe("Maximum number of logs to return (default 50)"),
    },
    async ({ workspaceId, webhookId, limit }) => {
      const result = await convex.query(api.functions.integrations.queries.getWebhookLogs, {
        workspaceId: workspaceId as any,
        webhookId: webhookId as any,
        limit,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "integrations.createTemplate",
    `Create a reusable HTTP request template.
Templates can use {{variable}} placeholders in URL, headers, and body.
Auth credentials are stored as environment variable NAMES (not values).`,
    {
      workspaceId: z.string().describe("Workspace ID"),
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
      actorId: z.string().describe("ID of the workspace member creating this"),
    },
    async (args) => {
      const result = await convex.mutation(api.functions.integrations.mutations.createHttpTemplate, {
        workspaceId: args.workspaceId as any,
        name: args.name,
        slug: args.slug,
        description: args.description,
        method: args.method,
        url: args.url,
        headers: args.headers,
        body: args.body,
        auth: args.auth,
        actorId: args.actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "integrations.listTemplates",
    "List all HTTP request templates for a workspace",
    {
      workspaceId: z.string().describe("Workspace ID"),
    },
    async ({ workspaceId }) => {
      const result = await convex.query(api.functions.integrations.queries.listHttpTemplates, {
        workspaceId: workspaceId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "integrations.sendRequest",
    `Send an HTTP request directly or using a template.
Use either url/method/headers/body for ad-hoc requests, or templateSlug with variables.`,
    {
      workspaceId: z.string().describe("Workspace ID"),
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
      actorId: z.string().describe("ID of the workspace member"),
    },
    async (args) => {
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
      const result = await convex.action(api.functions.integrations.httpActions.sendRequest, {
        workspaceId: args.workspaceId as any,
        method: args.method,
        url: args.url,
        headers: args.headers,
        body: args.body,
        authConfig: args.authConfig,
        actorId: args.actorId as any,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "integrations.getRequestLogs",
    "Get logs of outgoing HTTP requests",
    {
      workspaceId: z.string().describe("Workspace ID"),
      templateId: z.string().optional().describe("Filter by template ID"),
      limit: z.number().optional().describe("Maximum number of logs to return (default 50)"),
    },
    async ({ workspaceId, templateId, limit }) => {
      const result = await convex.query(api.functions.integrations.queries.getHttpRequestLogs, {
        workspaceId: workspaceId as any,
        templateId: templateId as any,
        limit,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // START SERVER
  // ============================================================================

  return {
    start: async () => {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error("Massive CRM MCP server started");
    },
  };
}
