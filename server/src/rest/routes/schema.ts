import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { RestApiDependencies } from "../index.js";
import { ErrorResponseSchema, AttributeTypeSchema } from "../schemas/common.js";
import { toHonoPath } from "../utils/path.js";

export function createSchemaRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // GET /schema/object-types - List all object types
  // ============================================================================
  const listRoute = createRoute({
    method: "get",
    path: "/object-types",
    tags: ["Schema"],
    summary: "List all object types in the workspace",
    security: [{ Bearer: ["crm:read"] }],
    responses: {
      200: {
        description: "List of object types",
        content: { "application/json": { schema: z.any() } },
      },
    },
  });

  app.use(listRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(listRoute, async (c) => {
    const auth = c.get("auth");

    const result = await convex.query(api.functions.objectTypes.queries.list, {
      workspaceId: auth.workspaceId,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // GET /schema/object-types/:slug - Get object type with attributes
  // ============================================================================
  const getRoute = createRoute({
    method: "get",
    path: "/object-types/{slug}",
    tags: ["Schema"],
    summary: "Get an object type with its attributes",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      params: z.object({
        slug: z.string().describe("Object type slug"),
      }),
    },
    responses: {
      200: {
        description: "Object type with attributes",
        content: { "application/json": { schema: z.any() } },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(getRoute.path), createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(getRoute, async (c) => {
    const auth = c.get("auth");
    const { slug } = c.req.valid("param");

    const result = await convex.query(api.functions.objectTypes.queries.getWithAttributes, {
      workspaceId: auth.workspaceId,
      slug,
      actorId: auth.workspaceMemberId,
    });

    if (!result) {
      return c.json({ error: "not_found", message: "Object type not found" }, 404);
    }

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /schema/object-types - Create a new object type
  // ============================================================================
  const createObjectTypeRoute = createRoute({
    method: "post",
    path: "/object-types",
    tags: ["Schema"],
    summary: "Create a new custom object type",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().describe("Display name (e.g., 'Projects')"),
              singularName: z.string().describe("Singular form (e.g., 'Project')"),
              slug: z.string().describe("URL-safe identifier (e.g., 'projects')"),
              description: z.string().optional().describe("Description of the object type"),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Object type created",
        content: { "application/json": { schema: z.any() } },
      },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
      409: { description: "Already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(createObjectTypeRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(createObjectTypeRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.objectTypes.mutations.create, {
      workspaceId: auth.workspaceId,
      name: body.name,
      singularName: body.singularName,
      slug: body.slug,
      description: body.description,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // POST /schema/object-types/:slug/attributes - Add attribute to object type
  // ============================================================================
  const createAttributeRoute = createRoute({
    method: "post",
    path: "/object-types/{slug}/attributes",
    tags: ["Schema"],
    summary: "Add an attribute to an object type",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      params: z.object({
        slug: z.string().describe("Object type slug"),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().describe("Display name"),
              slug: z.string().describe("Attribute identifier"),
              type: AttributeTypeSchema.describe("Attribute type"),
              isRequired: z.boolean().optional().describe("Whether this field is required"),
              config: z.record(z.any()).optional().describe("Type-specific configuration"),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Attribute created",
        content: { "application/json": { schema: z.any() } },
      },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "Object type not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(createAttributeRoute.path), createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(createAttributeRoute, async (c) => {
    const auth = c.get("auth");
    const { slug: objectTypeSlug } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.attributes.mutations.create, {
      workspaceId: auth.workspaceId,
      objectTypeSlug,
      name: body.name,
      slug: body.slug,
      type: body.type,
      isRequired: body.isRequired ?? false,
      config: body.config ?? {},
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  return app;
}
