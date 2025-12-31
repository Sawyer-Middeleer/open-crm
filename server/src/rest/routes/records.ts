import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { RestApiDependencies } from "../index.js";
import {
  RecordIdSchema,
  PaginationQuerySchema,
  ErrorResponseSchema,
  SearchFilterSchema,
  MergeStrategySchema,
} from "../schemas/common.js";
import { toHonoPath } from "../utils/path.js";

export function createRecordsRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // POST /records - Create a record
  // ============================================================================
  const createRoute_ = createRoute({
    method: "post",
    path: "/",
    tags: ["Records"],
    summary: "Create a new record",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              objectType: z.string().describe("Object type slug (e.g., 'people', 'companies')"),
              data: z.record(z.any()).describe("Record data keyed by attribute slug"),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Record created",
        content: {
          "application/json": {
            schema: z.any(),
          },
        },
      },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
      401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(createRoute_.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(createRoute_, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.records.mutations.create, {
      workspaceId: auth.workspaceId,
      objectTypeSlug: body.objectType,
      data: body.data,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // GET /records/:id - Get a record
  // ============================================================================
  const getRoute = createRoute({
    method: "get",
    path: "/{id}",
    tags: ["Records"],
    summary: "Get a record by ID",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      params: z.object({
        id: RecordIdSchema,
      }),
    },
    responses: {
      200: {
        description: "Record found",
        content: { "application/json": { schema: z.any() } },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(getRoute.path), createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(getRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");

    const result = await convex.query(api.functions.records.queries.get, {
      workspaceId: auth.workspaceId,
      recordId: id as Id<"records">,
      actorId: auth.workspaceMemberId,
    });

    if (!result) {
      return c.json({ error: "not_found", message: "Record not found" }, 404);
    }

    return c.json(result, 200);
  });

  // ============================================================================
  // GET /records - List records
  // ============================================================================
  const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Records"],
    summary: "List records by object type",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      query: PaginationQuerySchema.extend({
        objectType: z.string().describe("Object type slug"),
        includeArchived: z.string().optional().transform((v) => v === "true"),
      }),
    },
    responses: {
      200: {
        description: "List of records",
        content: { "application/json": { schema: z.any() } },
      },
    },
  });

  app.use(listRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(listRoute, async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.records.queries.list, {
      workspaceId: auth.workspaceId,
      objectTypeSlug: query.objectType,
      includeArchived: query.includeArchived,
      paginationOpts: {
        numItems: query.numItems,
        cursor: query.cursor ?? null,
      },
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // PATCH /records/:id - Update a record
  // ============================================================================
  const updateRoute = createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["Records"],
    summary: "Update a record",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({ id: RecordIdSchema }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              data: z.record(z.any()).describe("Fields to update"),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Record updated", content: { "application/json": { schema: z.any() } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(updateRoute.path), createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(updateRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.records.mutations.update, {
      workspaceId: auth.workspaceId,
      recordId: id as Id<"records">,
      data: body.data,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // DELETE /records/:id - Delete a record
  // ============================================================================
  const deleteRoute = createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Records"],
    summary: "Delete a record",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({ id: RecordIdSchema }),
    },
    responses: {
      200: { description: "Record deleted", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(deleteRoute.path), createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(deleteRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");

    const result = await convex.mutation(api.functions.records.mutations.remove, {
      workspaceId: auth.workspaceId,
      recordId: id as Id<"records">,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/:id/archive - Archive a record
  // ============================================================================
  const archiveRoute = createRoute({
    method: "post",
    path: "/{id}/archive",
    tags: ["Records"],
    summary: "Archive a record (soft delete)",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({ id: RecordIdSchema }),
    },
    responses: {
      200: { description: "Record archived", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(toHonoPath(archiveRoute.path), createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(archiveRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");

    const result = await convex.mutation(api.functions.records.mutations.archive, {
      workspaceId: auth.workspaceId,
      recordId: id as Id<"records">,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/:id/restore - Restore an archived record
  // ============================================================================
  const restoreRoute = createRoute({
    method: "post",
    path: "/{id}/restore",
    tags: ["Records"],
    summary: "Restore an archived record",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({ id: RecordIdSchema }),
    },
    responses: {
      200: { description: "Record restored", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(toHonoPath(restoreRoute.path), createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(restoreRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");

    const result = await convex.mutation(api.functions.records.mutations.restore, {
      workspaceId: auth.workspaceId,
      recordId: id as Id<"records">,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/search - Search records
  // ============================================================================
  const searchRoute = createRoute({
    method: "post",
    path: "/search",
    tags: ["Records"],
    summary: "Search and filter records",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              objectType: z.string().optional().describe("Filter by object type slug"),
              filters: z.array(SearchFilterSchema).optional().describe("Filters (combined with AND)"),
              query: z.string().optional().describe("Text search across displayName and text fields"),
              sortBy: z.string().optional().describe("Attribute slug to sort by, or '_createdAt'"),
              sortOrder: z.enum(["asc", "desc"]).optional(),
              includeArchived: z.boolean().optional(),
              cursor: z.string().optional(),
              numItems: z.number().min(1).max(100).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Search results", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(searchRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(searchRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.query(api.functions.records.queries.search, {
      workspaceId: auth.workspaceId,
      objectTypeSlug: body.objectType,
      filters: body.filters,
      query: body.query,
      sortBy: body.sortBy,
      sortOrder: body.sortOrder,
      includeArchived: body.includeArchived,
      paginationOpts: {
        numItems: body.numItems ?? 50,
        cursor: body.cursor ?? null,
      },
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // GET /records/:id/related - Get related records
  // ============================================================================
  const relatedRoute = createRoute({
    method: "get",
    path: "/{id}/related",
    tags: ["Records"],
    summary: "Get related records via references or list memberships",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      params: z.object({ id: RecordIdSchema }),
      query: z.object({
        relationship: z.string().optional().describe("Filter to specific relationship"),
      }),
    },
    responses: {
      200: { description: "Related records", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(toHonoPath(relatedRoute.path), createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(relatedRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.records.queries.getRelated, {
      workspaceId: auth.workspaceId,
      recordId: id as Id<"records">,
      relationship: query.relationship,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // GET /records/:id/history - Get audit history
  // ============================================================================
  const historyRoute = createRoute({
    method: "get",
    path: "/{id}/history",
    tags: ["Records"],
    summary: "Get audit history for a record",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      params: z.object({ id: RecordIdSchema }),
      query: z.object({
        limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : undefined)),
      }),
    },
    responses: {
      200: { description: "Audit history", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(toHonoPath(historyRoute.path), createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(historyRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.audit.queries.getRecordHistory, {
      workspaceId: auth.workspaceId,
      recordId: id as Id<"records">,
      limit: query.limit,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/bulk/validate - Bulk validate records
  // ============================================================================
  const bulkValidateRoute = createRoute({
    method: "post",
    path: "/bulk/validate",
    tags: ["Records"],
    summary: "Validate records before bulk import",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              objectType: z.string(),
              records: z.array(
                z.object({
                  data: z.record(z.any()),
                  externalId: z.string().optional(),
                })
              ),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Validation results", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(bulkValidateRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(bulkValidateRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.records.mutations.bulkValidate, {
      workspaceId: auth.workspaceId,
      objectTypeSlug: body.objectType,
      records: body.records,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/bulk/commit - Commit validated records
  // ============================================================================
  const bulkCommitRoute = createRoute({
    method: "post",
    path: "/bulk/commit",
    tags: ["Records"],
    summary: "Commit validated records from a bulk validate session",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              sessionId: z.string(),
              mode: z.enum(["validOnly", "all"]).default("validOnly"),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Commit results", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(bulkCommitRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(bulkCommitRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.records.mutations.bulkCommit, {
      workspaceId: auth.workspaceId,
      sessionId: body.sessionId as Id<"bulkValidationSessions">,
      mode: body.mode,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/bulk/inspect - Inspect records from validation session
  // ============================================================================
  const bulkInspectRoute = createRoute({
    method: "post",
    path: "/bulk/inspect",
    tags: ["Records"],
    summary: "Inspect specific records from a validation session",
    description: "Use this to see full details of invalid records before deciding how to proceed.",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              sessionId: z.string().describe("Session ID from bulkValidate"),
              indices: z.array(z.number()).describe("Array of record indices to inspect (0-based)"),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Inspection results", content: { "application/json": { schema: z.any() } } },
      404: { description: "Session not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(bulkInspectRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(bulkInspectRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.query(api.functions.records.queries.bulkInspect, {
      workspaceId: auth.workspaceId,
      sessionId: body.sessionId as Id<"bulkValidationSessions">,
      indices: body.indices,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/bulk/update - Bulk update records
  // ============================================================================
  const bulkUpdateRoute = createRoute({
    method: "post",
    path: "/bulk/update",
    tags: ["Records"],
    summary: "Update multiple records with the same field values",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              recordIds: z.array(z.string()).min(1),
              data: z.record(z.any()),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Update results", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(bulkUpdateRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(bulkUpdateRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.records.mutations.bulkUpdate, {
      workspaceId: auth.workspaceId,
      recordIds: body.recordIds as Id<"records">[],
      data: body.data,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /records/merge - Merge records
  // ============================================================================
  const mergeRoute = createRoute({
    method: "post",
    path: "/merge",
    tags: ["Records"],
    summary: "Merge multiple source records into a target record",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              targetRecordId: z.string(),
              sourceRecordIds: z.array(z.string()).min(1),
              fieldStrategy: MergeStrategySchema.exclude(["skip"]).optional(),
              fieldOverrides: z.record(MergeStrategySchema).optional(),
              transferListMemberships: z.boolean().optional(),
              updateInboundReferences: z.boolean().optional(),
              deleteSources: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Merge result", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(mergeRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(mergeRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.records.mutations.merge, {
      workspaceId: auth.workspaceId,
      targetRecordId: body.targetRecordId as Id<"records">,
      sourceRecordIds: body.sourceRecordIds as Id<"records">[],
      fieldStrategy: body.fieldStrategy,
      fieldOverrides: body.fieldOverrides,
      transferListMemberships: body.transferListMemberships,
      updateInboundReferences: body.updateInboundReferences,
      deleteSources: body.deleteSources,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  return app;
}
