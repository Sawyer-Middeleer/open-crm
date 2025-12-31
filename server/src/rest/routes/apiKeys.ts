import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { RestApiDependencies } from "../index.js";
import { ErrorResponseSchema } from "../schemas/common.js";
import { generateApiKey } from "../../auth/strategies/apikey.js";

export function createApiKeysRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // POST /api-keys - Create a new API key
  // ============================================================================
  const createRoute_ = createRoute({
    method: "post",
    path: "/",
    tags: ["API Keys"],
    summary: "Create a new API key",
    description:
      "Creates a new API key for the current workspace. The raw key is returned ONCE in the response - it cannot be retrieved again.",
    security: [{ Bearer: ["crm:admin"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z
                .string()
                .min(1)
                .max(100)
                .describe("Descriptive name for this key"),
              scopes: z
                .array(z.enum(["crm:read", "crm:write", "crm:admin"]))
                .min(1)
                .describe("Permissions for this key"),
              expiresInDays: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Days until key expires (omit for no expiration)"),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "API key created",
        content: {
          "application/json": {
            schema: z.object({
              _id: z.string(),
              keyPrefix: z.string(),
              key: z.string().describe("The full API key - save this now!"),
              scopes: z.array(z.string()),
              expiresAt: z.number().nullable(),
              createdAt: z.number(),
              warning: z.string(),
            }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
      403: {
        description: "Insufficient permissions",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });

  app.use(createRoute_.path, createAuthMiddleware(authManager, "crm:admin"), userRateLimitMiddleware);
  app.openapi(createRoute_, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    // Generate the key
    const { rawKey, keyHash, keyPrefix } = generateApiKey("live");

    // Calculate expiration if provided
    const expiresAt = body.expiresInDays
      ? Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000
      : undefined;

    // Create in database
    const result = await convex.mutation(api.functions.auth.apiKeys.create, {
      userId: auth.userId,
      workspaceId: auth.workspaceId,
      name: body.name,
      keyHash,
      keyPrefix,
      scopes: body.scopes,
      expiresAt,
    });

    return c.json(
      {
        ...result,
        key: rawKey,
        warning: "Save this key now. It cannot be retrieved again.",
      },
      201
    );
  });

  // ============================================================================
  // GET /api-keys - List API keys
  // ============================================================================
  const listRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["API Keys"],
    summary: "List API keys for the current workspace",
    description: "Returns all API keys. Keys are shown with prefix only for security.",
    security: [{ Bearer: ["crm:admin"] }],
    responses: {
      200: {
        description: "List of API keys",
        content: {
          "application/json": {
            schema: z.array(
              z.object({
                _id: z.string(),
                name: z.string(),
                keyPrefix: z.string(),
                scopes: z.array(z.string()),
                isRevoked: z.boolean(),
                expiresAt: z.number().nullable(),
                lastUsedAt: z.number().nullable(),
                createdAt: z.number(),
              })
            ),
          },
        },
      },
    },
  });

  app.use(listRoute.path, createAuthMiddleware(authManager, "crm:admin"), userRateLimitMiddleware);
  app.openapi(listRoute, async (c) => {
    const auth = c.get("auth");

    const result = await convex.query(
      api.functions.auth.apiKeys.listByUserAndWorkspace,
      {
        userId: auth.userId,
        workspaceId: auth.workspaceId,
      }
    );

    return c.json(result, 200);
  });

  // ============================================================================
  // DELETE /api-keys/:id - Revoke an API key
  // ============================================================================
  const revokeRoute = createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["API Keys"],
    summary: "Revoke an API key",
    description: "Revokes an API key. The key will immediately stop working.",
    security: [{ Bearer: ["crm:admin"] }],
    request: {
      params: z.object({
        id: z.string().describe("API key ID"),
      }),
    },
    responses: {
      200: {
        description: "API key revoked",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
            }),
          },
        },
      },
      404: {
        description: "API key not found",
        content: { "application/json": { schema: ErrorResponseSchema } },
      },
    },
  });

  app.use(
    revokeRoute.path,
    createAuthMiddleware(authManager, "crm:admin"),
    userRateLimitMiddleware
  );
  app.openapi(revokeRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");

    const result = await convex.mutation(api.functions.auth.apiKeys.revoke, {
      keyId: id as Id<"apiKeys">,
      actorUserId: auth.userId,
    });

    return c.json(result, 200);
  });

  return app;
}
