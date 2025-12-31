import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { RestApiDependencies } from "../index.js";
import { ErrorResponseSchema, MemberRoleSchema } from "../schemas/common.js";
import { toHonoPath } from "../utils/path.js";

export function createWorkspacesRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // POST /workspaces - Create a workspace
  // ============================================================================
  const createWorkspaceRoute = createRoute({
    method: "post",
    path: "/",
    tags: ["Workspaces"],
    summary: "Create a new workspace",
    description: "Creates a new workspace with default object types (People, Companies, Deals).",
    security: [{ Bearer: ["crm:admin"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().describe("Workspace display name"),
              slug: z.string().describe("URL-safe identifier (must be unique)"),
            }),
          },
        },
      },
    },
    responses: {
      201: { description: "Workspace created", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
      409: { description: "Slug already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(createWorkspaceRoute.path, createAuthMiddleware(authManager, "crm:admin"), userRateLimitMiddleware);
  app.openapi(createWorkspaceRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.workspaces.mutations.create, {
      name: body.name,
      slug: body.slug,
      userId: auth.userId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // PATCH /workspaces/members/:id - Update member role
  // ============================================================================
  const updateMemberRoute = createRoute({
    method: "patch",
    path: "/members/{id}",
    tags: ["Workspaces"],
    summary: "Update a workspace member's role",
    description: "Only owners and admins can update roles. Only owners can promote to owner.",
    security: [{ Bearer: ["crm:admin"] }],
    request: {
      params: z.object({
        id: z.string().describe("Member ID to update"),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              role: MemberRoleSchema.describe("New role for the member"),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Member updated", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
      403: { description: "Insufficient permissions", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "Member not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(updateMemberRoute.path), createAuthMiddleware(authManager, "crm:admin"), userRateLimitMiddleware);
  app.openapi(updateMemberRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.workspaces.mutations.updateMember, {
      workspaceId: auth.workspaceId,
      memberId: id as Id<"workspaceMembers">,
      role: body.role,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // DELETE /workspaces/members/:id - Remove member
  // ============================================================================
  const removeMemberRoute = createRoute({
    method: "delete",
    path: "/members/{id}",
    tags: ["Workspaces"],
    summary: "Remove a member from the workspace",
    description: "Only owners and admins can remove members. Cannot remove the last owner.",
    security: [{ Bearer: ["crm:admin"] }],
    request: {
      params: z.object({
        id: z.string().describe("Member ID to remove"),
      }),
    },
    responses: {
      200: { description: "Member removed", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
      403: { description: "Insufficient permissions", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "Member not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(toHonoPath(removeMemberRoute.path), createAuthMiddleware(authManager, "crm:admin"), userRateLimitMiddleware);
  app.openapi(removeMemberRoute, async (c) => {
    const auth = c.get("auth");
    const { id } = c.req.valid("param");

    const result = await convex.mutation(api.functions.workspaces.mutations.removeMember, {
      workspaceId: auth.workspaceId,
      memberId: id as Id<"workspaceMembers">,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  return app;
}
