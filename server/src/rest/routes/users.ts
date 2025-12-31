import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { RestApiDependencies } from "../index.js";
import { ErrorResponseSchema } from "../schemas/common.js";

export function createUsersRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // GET /users/me - Get current user
  // ============================================================================
  const meRoute = createRoute({
    method: "get",
    path: "/me",
    tags: ["Users"],
    summary: "Get the currently authenticated user",
    security: [{ Bearer: ["crm:read"] }],
    responses: {
      200: {
        description: "Current user with workspaces",
        content: {
          "application/json": {
            schema: z.object({
              user: z.any(),
              workspaces: z.any(),
            }),
          },
        },
      },
    },
  });

  app.use(meRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(meRoute, async (c) => {
    const auth = c.get("auth");

    const [user, workspaces] = await Promise.all([
      convex.query(api.functions.auth.queries.getUser, {
        userId: auth.userId,
      }),
      convex.query(api.functions.auth.queries.listUserWorkspaces, {
        userId: auth.userId,
      }),
    ]);

    return c.json({ user, workspaces }, 200);
  });

  // ============================================================================
  // PATCH /users/me/preferences - Update user preferences
  // ============================================================================
  const updatePreferencesRoute = createRoute({
    method: "patch",
    path: "/me/preferences",
    tags: ["Users"],
    summary: "Update the current user's preferences",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              defaultWorkspaceId: z.string().optional().describe("Default workspace ID"),
              timezone: z.string().optional().describe("User's timezone (e.g., 'America/New_York')"),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Preferences updated", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(updatePreferencesRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(updatePreferencesRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.auth.mutations.updateUserPreferences, {
      userId: auth.userId,
      preferences: {
        defaultWorkspaceId: body.defaultWorkspaceId as Id<"workspaces"> | undefined,
        timezone: body.timezone,
      },
    });

    return c.json(result, 200);
  });

  return app;
}
