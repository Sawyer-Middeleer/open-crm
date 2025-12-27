import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, type McpServerWrapper } from "./server.js";
import {
  createAuthManager,
  loadAuthConfig,
  createUnauthorizedResponse,
  type AuthContext,
} from "./auth/index.js";

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
 * Get CORS headers for a request origin
 */
function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-Workspace-Id, Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };

  // If no allowed origins configured, block cross-origin (safe default)
  if (ALLOWED_ORIGINS.length === 0) {
    return headers;
  }

  // Check if origin is in allowlist
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

/**
 * Handle OAuth protected resource metadata endpoint
 */
function handleWellKnown(resourceUri?: string): Response {
  const metadata = {
    resource: resourceUri ?? "https://api.agent-crm.example/mcp",
    bearer_methods_supported: ["header"],
    resource_signing_alg_values_supported: ["RS256", "ES256"],
  };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "max-age=3600",
    },
  });
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
          headers: getCorsHeaders(origin),
        });
      }

      // Well-known OAuth metadata
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return handleWellKnown(config.resourceUri);
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
          const corsHeaderValues = getCorsHeaders(origin);
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
