import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { api } from "../../../../convex/_generated/api.js";
import type { Id } from "../../../../convex/_generated/dataModel.js";
import { createAuthMiddleware, type AuthVariables } from "../middleware/auth.js";
import { userRateLimitMiddleware } from "../middleware/rateLimit.js";
import { validateUrl, validateUrlPattern } from "../../lib/validation.js";
import type { RestApiDependencies } from "../index.js";
import {
  ErrorResponseSchema,
  HttpMethodSchema,
  AuthTypeSchema,
  WebhookHandlerTypeSchema,
} from "../schemas/common.js";

export function createIntegrationsRoutes(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  const { authManager, convex } = deps;

  // ============================================================================
  // POST /integrations/webhooks - Create incoming webhook endpoint
  // ============================================================================
  const createWebhookRoute = createRoute({
    method: "post",
    path: "/webhooks",
    tags: ["Integrations"],
    summary: "Create an incoming webhook endpoint",
    description: "Returns a URL and secret. The secret is only shown once.",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().describe("Webhook name"),
              slug: z.string().describe("URL slug (used in webhook URL path)"),
              description: z.string().optional(),
              handlerType: WebhookHandlerTypeSchema.describe("What to do with the webhook payload"),
              objectType: z.string().optional().describe("Object type slug (for createRecord handler)"),
              fieldMapping: z.record(z.string()).optional().describe("Map payload paths to field slugs"),
              actionSlug: z.string().optional().describe("Action slug (for triggerAction handler)"),
            }),
          },
        },
      },
    },
    responses: {
      201: { description: "Webhook created", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(createWebhookRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(createWebhookRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    const result = await convex.mutation(api.functions.integrations.mutations.createIncomingWebhook, {
      workspaceId: auth.workspaceId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      handler: {
        type: body.handlerType,
        objectType: body.objectType,
        fieldMapping: body.fieldMapping,
        actionSlug: body.actionSlug,
      },
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // GET /integrations/webhooks - List webhook endpoints
  // ============================================================================
  const listWebhooksRoute = createRoute({
    method: "get",
    path: "/webhooks",
    tags: ["Integrations"],
    summary: "List all incoming webhook endpoints",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      query: z.object({
        includeInactive: z.string().optional().transform((v) => v === "true"),
      }),
    },
    responses: {
      200: { description: "List of webhooks", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(listWebhooksRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(listWebhooksRoute, async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.integrations.queries.listIncomingWebhooks, {
      workspaceId: auth.workspaceId,
      includeInactive: query.includeInactive,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // GET /integrations/webhooks/logs - Get webhook logs
  // ============================================================================
  const getWebhookLogsRoute = createRoute({
    method: "get",
    path: "/webhooks/logs",
    tags: ["Integrations"],
    summary: "Get logs of received webhook requests",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      query: z.object({
        webhookId: z.string().optional().describe("Filter by specific webhook ID"),
        limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 50)),
      }),
    },
    responses: {
      200: { description: "Webhook logs", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(getWebhookLogsRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(getWebhookLogsRoute, async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.integrations.queries.getWebhookLogs, {
      workspaceId: auth.workspaceId,
      webhookId: query.webhookId as Id<"incomingWebhooks"> | undefined,
      limit: query.limit,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /integrations/templates - Create HTTP request template
  // ============================================================================
  const createTemplateRoute = createRoute({
    method: "post",
    path: "/templates",
    tags: ["Integrations"],
    summary: "Create a reusable HTTP request template",
    description: "Templates can use {{variable}} placeholders in URL, headers, and body.",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().describe("Template name"),
              slug: z.string().describe("Unique template slug"),
              description: z.string().optional(),
              method: HttpMethodSchema,
              url: z.string().describe("Request URL (can include {{variable}} placeholders)"),
              headers: z.record(z.string()).optional(),
              body: z.any().optional(),
              auth: z
                .object({
                  type: AuthTypeSchema,
                  tokenEnvVar: z.string().optional(),
                  usernameEnvVar: z.string().optional(),
                  passwordEnvVar: z.string().optional(),
                  headerName: z.string().optional(),
                  keyEnvVar: z.string().optional(),
                })
                .optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: { description: "Template created", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(createTemplateRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(createTemplateRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    // Validate URL pattern to prevent SSRF
    const urlValidation = validateUrlPattern(body.url);
    if (!urlValidation.valid) {
      return c.json({ error: "validation_error", message: urlValidation.error ?? "Invalid URL" }, 400);
    }

    const result = await convex.mutation(api.functions.integrations.mutations.createHttpTemplate, {
      workspaceId: auth.workspaceId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      method: body.method,
      url: body.url,
      headers: body.headers,
      body: body.body,
      auth: body.auth,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 201);
  });

  // ============================================================================
  // GET /integrations/templates - List HTTP templates
  // ============================================================================
  const listTemplatesRoute = createRoute({
    method: "get",
    path: "/templates",
    tags: ["Integrations"],
    summary: "List all HTTP request templates",
    security: [{ Bearer: ["crm:read"] }],
    responses: {
      200: { description: "List of templates", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(listTemplatesRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(listTemplatesRoute, async (c) => {
    const auth = c.get("auth");

    const result = await convex.query(api.functions.integrations.queries.listHttpTemplates, {
      workspaceId: auth.workspaceId,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // POST /integrations/request - Send HTTP request
  // ============================================================================
  const sendRequestRoute = createRoute({
    method: "post",
    path: "/request",
    tags: ["Integrations"],
    summary: "Send an HTTP request",
    security: [{ Bearer: ["crm:write"] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              method: HttpMethodSchema.describe("HTTP method"),
              url: z.string().describe("Request URL"),
              headers: z.record(z.string()).optional(),
              body: z.any().optional(),
              authConfig: z
                .object({
                  type: z.string(),
                  tokenEnvVar: z.string().optional(),
                  usernameEnvVar: z.string().optional(),
                  passwordEnvVar: z.string().optional(),
                  headerName: z.string().optional(),
                  keyEnvVar: z.string().optional(),
                })
                .optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Request result", content: { "application/json": { schema: z.any() } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  app.use(sendRequestRoute.path, createAuthMiddleware(authManager, "crm:write"), userRateLimitMiddleware);
  app.openapi(sendRequestRoute, async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");

    // Validate URL to prevent SSRF
    const urlValidation = validateUrl(body.url);
    if (!urlValidation.valid) {
      return c.json({ error: "validation_error", message: urlValidation.error ?? "Invalid URL" }, 400);
    }

    const result = await convex.action(api.functions.integrations.httpActions.sendRequest, {
      workspaceId: auth.workspaceId,
      method: body.method,
      url: body.url,
      headers: body.headers,
      body: body.body,
      authConfig: body.authConfig,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  // ============================================================================
  // GET /integrations/request/logs - Get HTTP request logs
  // ============================================================================
  const getRequestLogsRoute = createRoute({
    method: "get",
    path: "/request/logs",
    tags: ["Integrations"],
    summary: "Get logs of outgoing HTTP requests",
    security: [{ Bearer: ["crm:read"] }],
    request: {
      query: z.object({
        templateId: z.string().optional().describe("Filter by template ID"),
        limit: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 50)),
      }),
    },
    responses: {
      200: { description: "Request logs", content: { "application/json": { schema: z.any() } } },
    },
  });

  app.use(getRequestLogsRoute.path, createAuthMiddleware(authManager, "crm:read"), userRateLimitMiddleware);
  app.openapi(getRequestLogsRoute, async (c) => {
    const auth = c.get("auth");
    const query = c.req.valid("query");

    const result = await convex.query(api.functions.integrations.queries.getHttpRequestLogs, {
      workspaceId: auth.workspaceId,
      templateId: query.templateId as Id<"httpTemplates"> | undefined,
      limit: query.limit,
      actorId: auth.workspaceMemberId,
    });

    return c.json(result, 200);
  });

  return app;
}
