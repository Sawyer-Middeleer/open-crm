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
        workspaceId,
        objectTypeSlug: objectType,
        data,
        actorId,
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
        workspaceId,
        recordId,
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
        workspaceId,
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
        workspaceId,
        recordId,
        data,
        actorId,
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
        workspaceId,
        recordId,
        actorId,
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
        workspaceId,
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
        workspaceId,
        recordId,
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
        workspaceId,
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
        workspaceId,
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
        workspaceId,
        name,
        singularName,
        slug,
        description,
        actorId,
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
        workspaceId,
        objectTypeSlug: objectType,
        name,
        slug,
        type,
        isRequired: isRequired ?? false,
        config: config ?? {},
        actorId,
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
    "lists.getEntries",
    "Get entries from a list, optionally filtered by parent record",
    {
      workspaceId: z.string().describe("Workspace ID"),
      listSlug: z.string().describe("List slug"),
      parentRecordId: z.string().optional().describe("Filter by parent record ID"),
    },
    async ({ workspaceId, listSlug, parentRecordId }) => {
      const result = await convex.query(api.functions.lists.queries.getEntries, {
        workspaceId,
        listSlug,
        parentRecordId,
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
        workspaceId,
        listSlug,
        recordId,
        parentRecordId,
        data: data ?? {},
        actorId,
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
        workspaceId,
        listSlug,
        recordId,
        parentRecordId,
        actorId,
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
        workspaceId,
        recordId,
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
        workspaceId,
        actionSlug,
        recordId,
        actorId,
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
        workspaceId,
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
