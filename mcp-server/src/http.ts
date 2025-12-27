import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, type McpServerWrapper } from "./server.js";
import {
  createAuthManager,
  loadAuthConfig,
  createUnauthorizedResponse,
  type AuthContext,
} from "./auth/index.js";

// Session to auth context mapping
const sessionAuthMap = new Map<string, AuthContext>();

// Session to transport mapping
const sessionTransportMap = new Map<
  string,
  WebStandardStreamableHTTPServerTransport
>();

/**
 * Handle OAuth protected resource metadata endpoint
 */
function handleWellKnown(resourceUri?: string): Response {
  const metadata = {
    resource: resourceUri ?? "https://api.massive-crm.example/mcp",
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
  // For existing sessions, return the existing transport
  if (sessionId && sessionTransportMap.has(sessionId)) {
    return sessionTransportMap.get(sessionId)!;
  }

  // Create new transport
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sessionTransportMap.set(newSessionId, transport);
      console.log(`[MCP] Session initialized: ${newSessionId}`);
    },
    onsessionclosed: (closedSessionId) => {
      sessionTransportMap.delete(closedSessionId);
      sessionAuthMap.delete(closedSessionId);
      console.log(`[MCP] Session closed: ${closedSessionId}`);
    },
    enableJsonResponse: true, // Allow JSON responses for simple request/response
  });

  // Connect the MCP server to this transport
  // Note: In a real implementation, you might want to create a new server per session
  // or share the server across sessions depending on your needs
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

  console.log(`[MCP] Starting HTTP server on ${hostname}:${port}`);

  Bun.serve({
    port,
    hostname,
    fetch: async (request): Promise<Response> => {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-API-Key, X-Workspace-Id, Mcp-Session-Id",
            "Access-Control-Max-Age": "86400",
          },
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

          // Store auth context for session
          if (transport.sessionId) {
            sessionAuthMap.set(transport.sessionId, authContext);
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
          const corsHeaders = new Headers(response.headers);
          corsHeaders.set("Access-Control-Allow-Origin", "*");

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: corsHeaders,
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
  return sessionAuthMap.get(sessionId);
}
