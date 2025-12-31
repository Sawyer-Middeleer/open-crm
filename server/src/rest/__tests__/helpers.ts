import { mock } from "bun:test";
import type { AuthContext } from "../../auth/types.js";
import { createRestApi } from "../index.js";

/**
 * Create a mock AuthContext for testing
 */
export function createMockAuthContext(
  overrides?: Partial<AuthContext>
): AuthContext {
  return {
    userId: "user_123" as any,
    email: "test@example.com",
    workspaceId: "ws_123" as any,
    workspaceMemberId: "wm_123" as any,
    role: "admin",
    authMethod: "oauth",
    scopes: ["crm:admin"],
    ...overrides,
  };
}

/**
 * Create a mock AuthManager that returns a fixed AuthContext
 */
export function createMockAuthManager(context?: AuthContext) {
  return {
    authenticate: mock(async () => context ?? createMockAuthContext()),
  };
}

/**
 * Create a mock Convex client with configurable responses
 */
export function createMockConvex(overrides?: {
  queryResult?: any;
  mutationResult?: any;
  actionResult?: any;
}) {
  return {
    query: mock(async () => overrides?.queryResult ?? { page: [], isDone: true }),
    mutation: mock(async () => overrides?.mutationResult ?? { _id: "test_123" }),
    action: mock(async () => overrides?.actionResult ?? { success: true }),
  };
}

/**
 * Create a test app with mocked dependencies
 */
export function createTestApp(convexOverrides?: Parameters<typeof createMockConvex>[0]) {
  return createRestApi({
    authManager: createMockAuthManager() as any,
    convex: createMockConvex(convexOverrides) as any,
  });
}

/**
 * Create a JSON request for testing
 */
export function jsonRequest(
  path: string,
  method = "GET",
  body?: object
): Request {
  return new Request(`http://test${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
