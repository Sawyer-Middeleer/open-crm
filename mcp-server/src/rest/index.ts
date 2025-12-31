import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import type { ConvexHttpClient } from "convex/browser";
import type { AuthManager } from "../auth/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { ipRateLimitMiddleware } from "./middleware/rateLimit.js";
import type { AuthVariables } from "./middleware/auth.js";

// Route imports
import { createRecordsRoutes } from "./routes/records.js";
import { createSchemaRoutes } from "./routes/schema.js";
import { createListsRoutes } from "./routes/lists.js";
import { createActionsRoutes } from "./routes/actions.js";
import { createIntegrationsRoutes } from "./routes/integrations.js";
import { createUsersRoutes } from "./routes/users.js";
import { createWorkspacesRoutes } from "./routes/workspaces.js";

/**
 * Dependencies required by the REST API
 */
export interface RestApiDependencies {
  authManager: AuthManager;
  convex: ConvexHttpClient;
}

/**
 * Create the REST API Hono app
 */
export function createRestApi(deps: RestApiDependencies) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  // Global error handler
  app.onError(errorHandler);

  // IP rate limiting (before auth)
  app.use("*", ipRateLimitMiddleware);

  // Mount route groups
  app.route("/records", createRecordsRoutes(deps));
  app.route("/schema", createSchemaRoutes(deps));
  app.route("/lists", createListsRoutes(deps));
  app.route("/actions", createActionsRoutes(deps));
  app.route("/integrations", createIntegrationsRoutes(deps));
  app.route("/users", createUsersRoutes(deps));
  app.route("/workspaces", createWorkspacesRoutes(deps));

  // OpenAPI spec endpoint
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Agent CRM REST API",
      version: "1.0.0",
      description:
        "RESTful API for Agent CRM - a headless, MCP-first CRM built for AI agents and traditional applications.",
    },
    servers: [
      {
        url: "/api/v1",
        description: "API v1",
      },
    ],
    security: [{ Bearer: [] }],
  });

  // Swagger UI
  app.get(
    "/docs",
    swaggerUI({
      url: "/api/v1/openapi.json",
    })
  );

  // Register security scheme for OpenAPI
  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "OAuth 2.0 Bearer token. Include scopes: crm:read, crm:write, or crm:admin.",
  });

  return app;
}
