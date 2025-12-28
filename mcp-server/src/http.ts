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

// Session TTL configuration
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min idle timeout
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 min

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
function handleWellKnown(config: AuthConfig): Response {
  const hostname = process.env.HOSTNAME ?? "localhost";
  const port = process.env.PORT ?? "3000";
  const defaultResource = `https://${hostname}:${port}/mcp`;

  const metadata: Record<string, unknown> = {
    // REQUIRED: The protected resource identifier
    resource: config.resourceUri ?? defaultResource,

    // Bearer token methods supported
    bearer_methods_supported: ["header"],

    // Signing algorithms the resource server accepts
    resource_signing_alg_values_supported: ["RS256", "ES256"],

    // Scopes that this resource server understands
    scopes_supported: getSupportedScopes(),
  };

  // Add authorization server hints if OAuth is configured
  if (config.oauth) {
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
    case "propelauth":
      if (config.oauth.propelAuthUrl) {
        return [config.oauth.propelAuthUrl];
      }
      break;

    case "auth0":
      if (config.oauth.auth0Domain) {
        return [`https://${config.oauth.auth0Domain}`];
      }
      break;

    case "workos":
      // WorkOS authorization endpoint
      return ["https://api.workos.com"];

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

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const hostname = process.env.HOSTNAME ?? "0.0.0.0";

  // Start session cleanup timer
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
        return handleWellKnown(config);
      }

      // Health check
      if (url.pathname === "/health") {
        return handleHealthCheck();
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        try {
          // Convert request headers to our format
          const headers: Record<string, string | undefined> = {};
          request.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });

          // Authenticate the request
          const authContext = await authManager.authenticate({ headers });

          // Get or create transport for this session
          const sessionId = headers["mcp-session-id"];
          const transport = getOrCreateTransport(sessionId, mcpServer);

          // Store or update session entry
          if (transport.sessionId) {
            const existingEntry = sessions.get(transport.sessionId);
            if (existingEntry) {
              existingEntry.auth = authContext;
              existingEntry.lastActivityAt = Date.now();
            } else {
              sessions.set(transport.sessionId, {
                auth: authContext,
                transport,
                lastActivityAt: Date.now(),
              });
            }
          }

          // Handle the MCP request
          const response = await transport.handleRequest(request, {
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
          console.error("[MCP] Auth error:", error);

          // Handle AuthError with proper RFC 6750 responses
          if (error instanceof AuthError) {
            // Insufficient scope → 403 with scope parameter
            if (error.oauthError === "insufficient_scope") {
              return createInsufficientScopeResponse(
                error.message.replace("Insufficient scope: requires ", ""),
                config.resourceUri
              );
            }

            // Workspace access denied (403 without OAuth error)
            if (error.statusCode === 403) {
              return createForbiddenResponse(error.message);
            }

            // Invalid token, expired token, etc. → 401
            return createUnauthorizedResponse(
              error.message,
              config.resourceUri,
              error.oauthError
            );
          }

          // Unknown errors → generic 401
          return createUnauthorizedResponse(
            error instanceof Error ? error.message : "Authentication failed",
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
  console.log(`[MCP] Health check: http://${hostname}:${port}/health`);
}

/**
 * Get auth context for a session ID
 */
export function getAuthContext(sessionId: string): AuthContext | undefined {
  return sessions.get(sessionId)?.auth;
}
