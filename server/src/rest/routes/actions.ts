import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { RestApiDependencies } from "../index.js";
import {
  RecordIdSchema,
  ErrorResponseSchema,
  TriggerTypeSchema,
  StepTypeSchema,
} from "../schemas/common.js";
import { toHonoPath } from "../utils/path.js";

export function createActionsRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // GET /actions - List actions
  // ============================================================================
  const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Actions"],
    summary: "List available actions",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      query: z.object({
        objectType: z.string().optional().describe("Filter by object type slug"),
      }),
    },
    responses: {
      200: { description: "List of actions", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(listRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(listRoute, async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.actions.queries.list, {
      workspaceId: auth.workspaceId,
      objectTypeSlug: query.objectType,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /actions - Create an action
  // ============================================================================
  const createActionRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["Actions"],
    summary: "Create an automation action",
    description: `Create an automation action with triggers, conditions, and steps.

**Step Types:**
- updateField, clearField, copyField, transformField
- updateRelatedRecord, createRecord, deleteRecord, archiveRecord
- addToList, removeFromList, updateListEntry
- sendWebhook, condition, loop

**Variable interpolation:** Use \`{{record.field}}\`, \`{{previous.output}}\`, \`{{loopItem}}\`, \`{{loopIndex}}\``,
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().describe("Action name"),
              slug: z.string().describe("Unique action slug"),
              description: z.string().optional(),
              trigger: z.object({
                type: TriggerTypeSchema,
                objectType: z.string().optional().describe("Object type slug (for record triggers)"),
                list: z.string().optional().describe("List slug (for list triggers)"),
                watchedFields: z.array(z.string()).optional().describe("Fields to watch (for onFieldChange)"),
                schedule: z.string().optional().describe("Cron expression (for scheduled)"),
              }),
              conditions: z
                .array(
                  z.object({
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
                  })
                )
                .optional()
                .describe("Conditions that must pass for action to run"),
              steps: z.array(
                z.object({
                  id: z.string().describe("Unique step identifier"),
                  type: StepTypeSchema,
                  name: z.string().optional(),
                  config: z.record(z.any()).describe("Step configuration"),
                  thenSteps: z.array(z.any()).optional(),
                  elseSteps: z.array(z.any()).optional(),
                  steps: z.array(z.any()).optional(),
                })
              ),
              isActive: z.boolean().optional().default(true),
            }),
          },
        },
      },
    },
    responses: {
      201: { description: "Action created", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(createActionRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(createActionRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.actions.mutations.createWithSlugs, {
      workspaceId: auth.workspaceId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      trigger: body.trigger,
      conditions: body.conditions as any,
      steps: body.steps as any,
      isActive: body.isActive,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // DELETE /actions/:id - Delete an action
  // ============================================================================
  const deleteRoute = createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Actions"],
    summary: "Delete an action",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({
        id: z.string().describe("Action ID"),
      }),
    },
    responses: {
      200: { description: "Action deleted", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(deleteRoute.path), createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(deleteRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");

    const result = await convex.mutation(api.functions.actions.mutations.remove, {
      workspaceId: auth.workspaceId,
      actionId: id as Id<"actions">,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /actions/:slug/execute - Execute an action on a record
  // ============================================================================
  const executeRoute = createRoute({
    method: "post",
    path: "/{slug}/execute",
    tags: ["Actions"],
    summary: "Execute an action on a record",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({
        slug: z.string().describe("Action slug"),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              recordId: RecordIdSchema.describe("Record to execute action on"),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Execution result", content: { "application/json": { schema: z.any() } } },
      400: { description: "Execution error", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "Action or record not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(executeRoute.path), createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(executeRoute, async (c) => {
    const auth = c.get("auth");
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.actions.mutations.execute, {
      workspaceId: auth.workspaceId,
      actionSlug: slug,
      recordId: body.recordId as Id<"records">,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  return app;
}
