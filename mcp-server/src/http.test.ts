import { describe, test, expect, beforeAll, afterAll } from "bun:test";

// Test configuration
const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Server instance
let server: ReturnType<typeof Bun.serve> | null = null;

// Minimal server for testing HTTP layer (without full MCP)
function startTestServer() {
  const ALLOWED_ORIGINS = ["https://app.example.com"];

  return Bun.serve({
    port: TEST_PORT,
    fetch: async (request): Promise<Response> => {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");

      // CORS preflight
      if (request.method === "OPTIONS") {
        const headers: Record<string, string> = {
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-API-Key, X-Workspace-Id, Mcp-Session-Id",
          "Access-Control-Max-Age": "86400",
        };

        if (origin && ALLOWED_ORIGINS.includes(origin)) {
          headers["Access-Control-Allow-Origin"] = origin;
          headers["Access-Control-Allow-Credentials"] = "true";
        }

        return new Response(null, { status: 204, headers });
      }

      // Health check
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Well-known OAuth metadata
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return new Response(
          JSON.stringify({
            resource: "https://api.agent-crm.example/mcp",
            bearer_methods_supported: ["header"],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "max-age=3600",
            },
          }
        );
      }

      // MCP endpoint (mock auth check)
      if (url.pathname === "/mcp") {
        const apiKey = request.headers.get("x-api-key");
        const authHeader = request.headers.get("authorization");

        if (!apiKey && !authHeader) {
          return new Response(
            JSON.stringify({ error: "unauthorized", message: "No valid authentication provided" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        // Mock invalid key check
        if (apiKey === "crm_invalid_key") {
          return new Response(
            JSON.stringify({ error: "unauthorized", message: "Invalid API key" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ status: "authenticated" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 404 for other paths
      return new Response(
        JSON.stringify({ error: "Not found", path: url.pathname }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    },
  });
}

describe("HTTP Server Integration", () => {
  beforeAll(() => {
    server = startTestServer();
  });

  afterAll(() => {
    server?.stop();
  });

  describe("Health Check", () => {
    test("GET /health returns 200 with status", async () => {
      const response = await fetch(`${BASE_URL}/health`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
    });
  });

  describe("Well-Known Endpoints", () => {
    test("GET /.well-known/oauth-protected-resource returns metadata", async () => {
      const response = await fetch(
        `${BASE_URL}/.well-known/oauth-protected-resource`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toContain("max-age");

      const body = await response.json();
      expect(body.resource).toBeDefined();
      expect(body.bearer_methods_supported).toContain("header");
    });
  });

  describe("CORS", () => {
    test("preflight returns correct headers for allowed origin", async () => {
      const response = await fetch(`${BASE_URL}/mcp`, {
        method: "OPTIONS",
        headers: { Origin: "https://app.example.com" },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://app.example.com"
      );
      expect(response.headers.get("access-control-allow-credentials")).toBe(
        "true"
      );
      expect(response.headers.get("access-control-allow-methods")).toContain(
        "POST"
      );
    });

    test("preflight blocks disallowed origin", async () => {
      const response = await fetch(`${BASE_URL}/mcp`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.com" },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  describe("Authentication", () => {
    test("returns 401 without auth headers", async () => {
      const response = await fetch(`${BASE_URL}/mcp`, {
        method: "POST",
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("unauthorized");
    });

    test("returns 401 with invalid API key", async () => {
      const response = await fetch(`${BASE_URL}/mcp`, {
        method: "POST",
        headers: { "X-API-Key": "crm_invalid_key" },
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.message).toContain("Invalid");
    });

    test("accepts valid API key format", async () => {
      const response = await fetch(`${BASE_URL}/mcp`, {
        method: "POST",
        headers: { "X-API-Key": "crm_abc123_secretkey" },
      });

      // Mock server returns 200 for any non-invalid key
      expect(response.status).toBe(200);
    });
  });

  describe("404 Handling", () => {
    test("returns 404 for unknown paths", async () => {
      const response = await fetch(`${BASE_URL}/unknown/path`);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("Not found");
      expect(body.path).toBe("/unknown/path");
    });
  });
});
