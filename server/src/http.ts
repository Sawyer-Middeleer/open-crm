import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, type McpServerWrapper } from "./server.js";
import {
  createAuthManager,
  loadAuthConfig,
  createUnauthorizedResponse,
  createInsufficientScopeResponse,
  createForbiddenResponse,
  getSupportedScopes,
  AuthError,
  type AuthContext,
  type AuthConfig,
} from "./auth/index.js";
import { getCorsHeaders } from "./lib/validation.js";
import {
  ipLimiter,
  userLimiter,
  createRateLimitResponse,
} from "./lib/rateLimiter.js";
import { getConvexClient } from "./convex/client.js";
import { createRestApi } from "./rest/index.js";
import {
  handleAuthorizationServerMetadata,
  handleAuthorize,
  handleCallback,
  handleToken,
  handleRegister,
  oauthStorage,
} from "./oauth/index.js";

// Session TTL configuration (configurable via env vars)
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MINUTES || "30", 10) * 60 * 1000;
const CLEANUP_INTERVAL_MS = parseInt(process.env.SESSION_CLEANUP_MINUTES || "5", 10) * 60 * 1000;

// Unified session storage with TTL tracking
interface SessionEntry {
  auth: AuthContext;
  transport: WebStandardStreamableHTTPServerTransport;
  lastActivityAt: number;
}

const sessions = new Map<string, SessionEntry>();

// CORS configuration
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Handle OAuth protected resource metadata endpoint (RFC 9728)
 * https://datatracker.ietf.org/doc/html/rfc9728
 */
function handleWellKnown(config: AuthConfig, request: Request): Response {
  // In dev mode without MCP_RESOURCE_URI, use request URL as resource
  const resourceUri =
    config.resourceUri ||
    (process.env.NODE_ENV !== "production"
      ? new URL(request.url).origin + "/mcp"
      : null);

  if (!resourceUri) {
    return new Response(
      JSON.stringify({ error: "MCP_RESOURCE_URI not configured" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const metadata: Record<string, unknown> = {
    // REQUIRED: The protected resource identifier
    resource: resourceUri,

    // Bearer token methods supported
    bearer_methods_supported: ["header"],

    // Signing algorithms the resource server accepts
    resource_signing_alg_values_supported: ["RS256", "ES256"],

    // Scopes that this resource server understands
    scopes_supported: getSupportedScopes(),
  };

  // Add authorization server hints
  // If OAuth proxy is enabled, point to self; otherwise point to external OAuth provider
  if (config.oauthProxy?.enabled) {
    // Point to our own OAuth AS endpoints
    const selfIssuer = resourceUri
      ? new URL(resourceUri).origin
      : new URL(request.url).origin;
    metadata.authorization_servers = [selfIssuer];
  } else if (config.oauth) {
    // Point to external OAuth provider (Auth0, etc.)
    const authServers = getAuthorizationServers(config);
    if (authServers.length > 0) {
      metadata.authorization_servers = authServers;
    }
  }

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "max-age=3600",
    },
  });
}

/**
 * Get authorization server URLs based on configured OAuth provider
 */
function getAuthorizationServers(config: AuthConfig): string[] {
  if (!config.oauth) return [];

  switch (config.oauth.provider) {
    case "auth0":
      if (config.oauth.auth0Domain) {
        return [`https://${config.oauth.auth0Domain}`];
      }
      break;

    case "custom":
      if (config.oauth.issuer) {
        return [config.oauth.issuer];
      }
      break;
  }

  return [];
}

/**
 * Handle health check endpoint
 */
function handleHealthCheck(): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Get or create transport for a session
 */
function getOrCreateTransport(
  sessionId: string | undefined,
  mcpServer: McpServerWrapper
): WebStandardStreamableHTTPServerTransport {
  // For existing sessions, return the existing transport and update activity
  if (sessionId && sessions.has(sessionId)) {
    const entry = sessions.get(sessionId)!;
    entry.lastActivityAt = Date.now();
    return entry.transport;
  }

  // Create new transport
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (newSessionId) => {
      // Note: auth will be added separately after authentication
      console.log(`[MCP] Session initialized: ${newSessionId}`);
    },
    onsessionclosed: (closedSessionId) => {
      sessions.delete(closedSessionId);
      console.log(`[MCP] Session closed: ${closedSessionId}`);
    },
    enableJsonResponse: true, // Allow JSON responses for simple request/response
  });

  // Connect the MCP server to this transport
  mcpServer.server.connect(transport);

  return transport;
}

/**
 * Start the HTTP server
 */
export async function startHttpServer(): Promise<void> {
  const config = loadAuthConfig();
  const authManager = createAuthManager(config);
  const mcpServer = createServer();
  const convex = getConvexClient();

  // Create REST API with shared dependencies
  const restApi = createRestApi({ authManager, convex });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const hostname = process.env.HOSTNAME ?? "0.0.0.0";

  // Start session and rate limiter cleanup timer
  setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;
    for (const [id, entry] of sessions) {
      if (now - entry.lastActivityAt > SESSION_TTL_MS) {
        sessions.delete(id);
        expiredCount++;
      }
    }
    if (expiredCount > 0) {
      console.log(`[MCP] Cleaned up ${expiredCount} expired sessions`);
    }

    // Clean up rate limiter entries
    const ipCleaned = ipLimiter.cleanup();
    const userCleaned = userLimiter.cleanup();
    if (ipCleaned > 0 || userCleaned > 0) {
      console.log(
        `[MCP] Cleaned up rate limits: ${ipCleaned} IP, ${userCleaned} user entries`
      );
    }

    // Clean up OAuth storage
    const oauthCleaned = oauthStorage.cleanup();
    if (oauthCleaned.authCodes > 0 || oauthCleaned.pkcePending > 0) {
      console.log(
        `[OAuth] Cleaned up: ${oauthCleaned.authCodes} auth codes, ${oauthCleaned.pkcePending} PKCE entries`
      );
    }
  }, CLEANUP_INTERVAL_MS);

  console.log(`[MCP] Starting HTTP server on ${hostname}:${port}`);

  Bun.serve({
    port,
    hostname,
    fetch: async (request): Promise<Response> => {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === "OPTIONS") {
        const origin = request.headers.get("origin");
        return new Response(null, {
          status: 204,
          headers: getCorsHeaders(origin, ALLOWED_ORIGINS),
        });
      }

      // Well-known OAuth metadata (RFC 9728)
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return handleWellKnown(config, request);
      }

      // Health check
      if (url.pathname === "/health") {
        return handleHealthCheck();
      }

      // OAuth Authorization Server Metadata (RFC 8414)
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return handleAuthorizationServerMetadata(config, request);
      }

      // OAuth Authorization Endpoint
      if (url.pathname === "/oauth/authorize" && request.method === "GET") {
        return handleAuthorize(request, config);
      }

      // OAuth Callback (from Auth0)
      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        return handleCallback(request, config);
      }

      // OAuth Token Endpoint
      if (url.pathname === "/oauth/token" && request.method === "POST") {
        return handleToken(request);
      }

      // OAuth Dynamic Client Registration
      if (url.pathname === "/oauth/register" && request.method === "POST") {
        return handleRegister(request, config);
      }

      // REST API endpoint
      if (url.pathname.startsWith("/api/v1")) {
        // Rewrite path to remove /api/v1 prefix for Hono router
        const restUrl = new URL(url.pathname.replace("/api/v1", "") || "/", request.url);
        const restRequest = new Request(restUrl.toString(), request);

        const response = await restApi.fetch(restRequest);

        // Add CORS headers to response
        const origin = request.headers.get("origin");
        const corsHeaderValues = getCorsHeaders(origin, ALLOWED_ORIGINS);
        const responseHeaders = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaderValues)) {
          responseHeaders.set(key, value);
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // IP-based rate limiting (before auth to prevent brute force)
        const clientIp =
          request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
          request.headers.get("x-real-ip") ||
          "unknown";

        const ipCheck = ipLimiter.check(clientIp);
        if (!ipCheck.allowed) {
          return createRateLimitResponse(ipCheck, ipLimiter.limit);
        }

        try {
          // Convert request headers to our format
          const headers: Record<string, string | undefined> = {};
          request.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });

          // Authenticate the request
          const authContext = await authManager.authenticate({ headers });

          // User-based rate limiting (after auth for per-user limits)
          const userCheck = userLimiter.check(authContext.userId);
          if (!userCheck.allowed) {
            return createRateLimitResponse(userCheck, userLimiter.limit);
          }

          // Get or create transport for this session
          const sessionId = headers["mcp-session-id"];
          const transport = getOrCreateTransport(sessionId, mcpServer);

          // Store or update session entry
          if (transport.sessionId) {
            const existingEntry = sessions.get(transport.sessionId);
            if (existingEntry) {
              // Validate session ownership - reject if auth identity changed
              if (
                existingEntry.auth.userId !== authContext.userId ||
                existingEntry.auth.workspaceId !== authContext.workspaceId
              ) {
                console.warn(
                  `[MCP] Session ownership mismatch for ${transport.sessionId}`
                );
                return createForbiddenResponse(
                  "Session belongs to a different identity. Start a new session."
                );
              }
              // Same identity - update activity timestamp only
              existingEntry.lastActivityAt = Date.now();
            } else {
              // New session
              sessions.set(transport.sessionId, {
                auth: authContext,
                transport,
                lastActivityAt: Date.now(),
              });
            }
          }

          // Handle the MCP request
          const requestForTransport = (() => {
            const accept = request.headers.get("accept") || "";
            if (accept.includes("text/event-stream") && accept.includes("application/json")) {
              return request;
            }
            const h = new Headers(request.headers);
            h.set("accept", "application/json, text/event-stream");
            return new Request(request, { headers: h });
          })();

          const response = await transport.handleRequest(requestForTransport, {
            authInfo: {
              // Map our auth context to MCP's AuthInfo
              // The MCP SDK passes this to message handlers via extra.authInfo
              token: authContext.userId,
              clientId: authContext.workspaceId,
              scopes: authContext.scopes ?? [],
              extra: {
                userId: authContext.userId,
                email: authContext.email,
                workspaceId: authContext.workspaceId,
                workspaceMemberId: authContext.workspaceMemberId,
                role: authContext.role,
                authMethod: authContext.authMethod,
                provider: authContext.provider,
              },
            },
          });

          // If this request initialized a new session, persist it now.
          // The transport may only know the sessionId after handling the first request.
          const responseSessionId =
            response.headers.get("mcp-session-id") ??
            response.headers.get("Mcp-Session-Id");
          if (responseSessionId && !sessions.has(responseSessionId)) {
            sessions.set(responseSessionId, {
              auth: authContext,
              transport,
              lastActivityAt: Date.now(),
            });
          }

          // Add CORS headers to response
          const origin = request.headers.get("origin");
          const corsHeaderValues = getCorsHeaders(origin, ALLOWED_ORIGINS);
          const responseHeaders = new Headers(response.headers);
          for (const [key, value] of Object.entries(corsHeaderValues)) {
            responseHeaders.set(key, value);
          }

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        } catch (error) {
          // Log detailed error server-side for debugging
          console.error("[MCP] Auth error:", error);

          // Handle AuthError with proper RFC 6750 responses
          // SECURITY: Return generic messages to clients, log details server-side
          if (error instanceof AuthError) {
            // Insufficient scope → 403 with scope parameter (safe to expose required scope)
            if (error.oauthError === "insufficient_scope") {
              return createInsufficientScopeResponse(
                error.message.replace("Insufficient scope: requires ", ""),
                config.resourceUri
              );
            }

            // Workspace access denied (403 without OAuth error)
            if (error.statusCode === 403) {
              return createForbiddenResponse("Access denied");
            }

            // Invalid token, expired token, etc. → 401 with generic message
            return createUnauthorizedResponse(
              "Authentication failed",
              config.resourceUri,
              error.oauthError
            );
          }

          // Unknown errors → generic 401
          return createUnauthorizedResponse(
            "Authentication failed",
            config.resourceUri
          );
        }
      }

      // 404 for other paths
      return new Response(
        JSON.stringify({ error: "Not found", path: url.pathname }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    },
  });

  console.log(`[MCP] HTTP server running on http://${hostname}:${port}`);
  console.log(`[MCP] MCP endpoint: http://${hostname}:${port}/mcp`);
  console.log(`[REST] REST API: http://${hostname}:${port}/api/v1`);
  console.log(`[REST] API Docs: http://${hostname}:${port}/api/v1/docs`);
  console.log(`[MCP] Health check: http://${hostname}:${port}/health`);
}

/**
 * Get auth context for a session ID
 */
export function getAuthContext(sessionId: string): AuthContext | undefined {
  return sessions.get(sessionId)?.auth;
}


