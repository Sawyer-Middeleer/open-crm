import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { RestApiDependencies } from "../index.js";
import { RecordIdSchema, ErrorResponseSchema, AttributeTypeSchema } from "../schemas/common.js";

export function createListsRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // POST /lists - Create a list
  // ============================================================================
  const createListRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["Lists"],
    summary: "Create a custom list (many-to-many relationship)",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().describe("List display name (e.g., 'Team Members')"),
              slug: z.string().describe("URL-safe identifier"),
              description: z.string().optional(),
              parentObjectType: z.string().optional().describe("Parent object type slug"),
              allowedObjectTypes: z.array(z.string()).describe("Object type slugs that can be added"),
              icon: z.string().optional(),
              attributes: z
                .array(
                  z.object({
                    name: z.string(),
                    slug: z.string(),
                    type: AttributeTypeSchema,
                    isRequired: z.boolean().optional(),
                    config: z.record(z.any()).optional(),
                  })
                )
                .optional()
                .describe("Custom attributes for list entries"),
            }),
          },
        },
      },
    },
    responses: {
      201: { description: "List created", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(createListRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(createListRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.lists.mutations.create, {
      workspaceId: auth.workspaceId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      parentObjectType: body.parentObjectType,
      allowedObjectTypes: body.allowedObjectTypes,
      icon: body.icon,
      attributes: body.attributes,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // GET /lists/:slug/entries - Get entries from a list
  // ============================================================================
  const getEntriesRoute = createRoute({
    method: "get",
    path: "/{slug}/entries",
    tags: ["Lists"],
    summary: "Get entries from a list",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      params: z.object({
        slug: z.string().describe("List slug"),
      }),
      query: z.object({
        parentRecordId: z.string().optional().describe("Filter by parent record ID"),
      }),
    },
    responses: {
      200: { description: "List entries", content: { "application/json": { schema: z.any() } } },
      404: { description: "List not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(getEntriesRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(getEntriesRoute, async (c) => {
    const auth = c.get("auth");
    const { slug } = c.req.valid("param");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.lists.queries.getEntries, {
      workspaceId: auth.workspaceId,
      listSlug: slug,
      parentRecordId: query.parentRecordId as Id<"records"> | undefined,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /lists/:slug/entries - Add entry to a list
  // ============================================================================
  const addEntryRoute = createRoute({
    method: "post",
    path: "/{slug}/entries",
    tags: ["Lists"],
    summary: "Add a record to a list",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({
        slug: z.string().describe("List slug"),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              recordId: RecordIdSchema.describe("Record to add"),
              parentRecordId: z.string().optional().describe("Parent record (for scoped lists)"),
              data: z.record(z.any()).optional().describe("List entry attribute values"),
            }),
          },
        },
      },
    },
    responses: {
      201: { description: "Entry added", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(addEntryRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(addEntryRoute, async (c) => {
    const auth = c.get("auth");
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.lists.mutations.addEntry, {
      workspaceId: auth.workspaceId,
      listSlug: slug,
      recordId: body.recordId as Id<"records">,
      parentRecordId: body.parentRecordId as Id<"records"> | undefined,
      data: body.data ?? {},
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // DELETE /lists/:slug/entries/:recordId - Remove entry from a list
  // ============================================================================
  const removeEntryRoute = createRoute({
    method: "delete",
    path: "/{slug}/entries/{recordId}",
    tags: ["Lists"],
    summary: "Remove a record from a list",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({
        slug: z.string().describe("List slug"),
        recordId: RecordIdSchema.describe("Record to remove"),
      }),
      query: z.object({
        parentRecordId: z.string().optional().describe("Parent record (for scoped lists)"),
      }),
    },
    responses: {
      200: { description: "Entry removed", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
      404: { description: "Entry not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(removeEntryRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(removeEntryRoute, async (c) => {
    const auth = c.get("auth");
    const { slug, recordId } = c.req.valid("param");
    const query = c.req.valid("query");

    const result = await convex.mutation(api.functions.lists.mutations.removeEntry, {
      workspaceId: auth.workspaceId,
      listSlug: slug,
      recordId: recordId as Id<"records">,
      parentRecordId: query.parentRecordId as Id<"records"> | undefined,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /lists/:slug/entries/bulk - Bulk add entries
  // ============================================================================
  const bulkAddRoute = createRoute({
    method: "post",
    path: "/{slug}/entries/bulk",
    tags: ["Lists"],
    summary: "Add multiple records to a list",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({
        slug: z.string().describe("List slug"),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              entries: z.array(
                z.object({
                  recordId: RecordIdSchema,
                  parentRecordId: z.string().optional(),
                  data: z.record(z.any()).optional(),
                })
              ),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Bulk add results", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(bulkAddRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(bulkAddRoute, async (c) => {
    const auth = c.get("auth");
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.lists.mutations.bulkAddEntry, {
      workspaceId: auth.workspaceId,
      listSlug: slug,
      entries: body.entries.map((e) => ({
        recordId: e.recordId as Id<"records">,
        parentRecordId: e.parentRecordId as Id<"records"> | undefined,
        data: e.data,
      })),
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // DELETE /lists/:slug/entries/bulk - Bulk remove entries
  // ============================================================================
  const bulkRemoveRoute = createRoute({
    method: "delete",
    path: "/{slug}/entries/bulk",
    tags: ["Lists"],
    summary: "Remove multiple records from a list",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({
        slug: z.string().describe("List slug"),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              entries: z.array(
                z.object({
                  recordId: RecordIdSchema,
                  parentRecordId: z.string().optional(),
                })
              ),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Bulk remove results", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(bulkRemoveRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(bulkRemoveRoute, async (c) => {
    const auth = c.get("auth");
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.lists.mutations.bulkRemoveEntry, {
      workspaceId: auth.workspaceId,
      listSlug: slug,
      entries: body.entries.map((e) => ({
        recordId: e.recordId as Id<"records">,
        parentRecordId: e.parentRecordId as Id<"records"> | undefined,
      })),
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  return app;
}
