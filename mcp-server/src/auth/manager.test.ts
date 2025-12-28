import { describe, test, expect, mock } from "bun:test";
import { AuthManager } from "./manager";
import { AuthError } from "./errors";
import type { AuthProvider, AuthContext, AuthRequest } from "./types";

// Helper to create mock auth context
function createMockContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user123" as any,
    workspaceId: "ws123" as any,
    workspaceMemberId: "wm123" as any,
    role: "admin",
    authMethod: "oauth",
    scopes: [],
    ...overrides,
  };
}

// Helper to create mock provider
function createMockProvider(
  name: string,
  priority: number,
  behavior: "success" | "null" | "auth-error" | "network-error" | "unknown-error",
  context?: AuthContext
): AuthProvider {
  return {
    name,
    priority,
    authenticate: mock(async (_request: AuthRequest) => {
      switch (behavior) {
        case "success":
          return context ?? createMockContext({ provider: name });
        case "null":
          return null;
        case "auth-error":
          throw new AuthError("Invalid credentials", 401, name);
        case "network-error":
          throw new Error("connect ECONNREFUSED 127.0.0.1:3000");
        case "unknown-error":
          throw new Error("Something unexpected happened");
      }
    }),
  };
}

describe("AuthManager", () => {
  test("returns context from first successful provider", async () => {
    const provider1 = createMockProvider("api-key", 10, "success");
    const provider2 = createMockProvider("oauth", 20, "success");

    const manager = new AuthManager({ providers: [provider1, provider2] });
    const result = await manager.authenticate({ headers: {} });

    expect(result.provider).toBe("api-key");
    expect(provider1.authenticate).toHaveBeenCalledTimes(1);
    expect(provider2.authenticate).toHaveBeenCalledTimes(0);
  });

  test("tries next provider when first returns null", async () => {
    const provider1 = createMockProvider("api-key", 10, "null");
    const provider2 = createMockProvider("oauth", 20, "success");

    const manager = new AuthManager({ providers: [provider1, provider2] });
    const result = await manager.authenticate({ headers: {} });

    expect(result.provider).toBe("oauth");
    expect(provider1.authenticate).toHaveBeenCalledTimes(1);
    expect(provider2.authenticate).toHaveBeenCalledTimes(1);
  });

  test("falls back to next provider on network error", async () => {
    const provider1 = createMockProvider("api-key", 10, "network-error");
    const provider2 = createMockProvider("oauth", 20, "success");

    const manager = new AuthManager({ providers: [provider1, provider2] });
    const result = await manager.authenticate({ headers: {} });

    expect(result.provider).toBe("oauth");
    expect(provider1.authenticate).toHaveBeenCalledTimes(1);
    expect(provider2.authenticate).toHaveBeenCalledTimes(1);
  });

  test("throws AuthError on explicit auth failure (no fallback)", async () => {
    const provider1 = createMockProvider("api-key", 10, "auth-error");
    const provider2 = createMockProvider("oauth", 20, "success");

    const manager = new AuthManager({ providers: [provider1, provider2] });

    await expect(manager.authenticate({ headers: {} })).rejects.toThrow(
      AuthError
    );
    expect(provider1.authenticate).toHaveBeenCalledTimes(1);
    expect(provider2.authenticate).toHaveBeenCalledTimes(0);
  });

  test("wraps and throws unknown errors", async () => {
    const provider1 = createMockProvider("api-key", 10, "unknown-error");

    const manager = new AuthManager({ providers: [provider1] });

    await expect(manager.authenticate({ headers: {} })).rejects.toThrow(
      AuthError
    );
    await expect(manager.authenticate({ headers: {} })).rejects.toThrow(
      /Something unexpected/
    );
  });

  test("throws when all providers return null", async () => {
    const provider1 = createMockProvider("api-key", 10, "null");
    const provider2 = createMockProvider("oauth", 20, "null");

    const manager = new AuthManager({ providers: [provider1, provider2] });

    await expect(manager.authenticate({ headers: {} })).rejects.toThrow(
      AuthError
    );
    await expect(manager.authenticate({ headers: {} })).rejects.toThrow(
      /No valid authentication/
    );
  });

  test("throws when all providers have network errors", async () => {
    const provider1 = createMockProvider("api-key", 10, "network-error");
    const provider2 = createMockProvider("oauth", 20, "network-error");

    const manager = new AuthManager({ providers: [provider1, provider2] });

    await expect(manager.authenticate({ headers: {} })).rejects.toThrow(
      AuthError
    );
  });

  test("sorts providers by priority", async () => {
    // Provide in wrong order
    const providerHigh = createMockProvider("oauth", 20, "null");
    const providerLow = createMockProvider("api-key", 10, "success");

    const manager = new AuthManager({
      providers: [providerHigh, providerLow],
    });
    const result = await manager.authenticate({ headers: {} });

    // Lower priority should be tried first
    expect(result.provider).toBe("api-key");
    expect(providerLow.authenticate).toHaveBeenCalledTimes(1);
    expect(providerHigh.authenticate).toHaveBeenCalledTimes(0);
  });

  test("passes request to provider", async () => {
    const provider = createMockProvider("api-key", 10, "success");
    const manager = new AuthManager({ providers: [provider] });

    const request = {
      headers: {
        "x-api-key": "test-key",
        "x-workspace-id": "ws123",
      },
    };
    await manager.authenticate(request);

    expect(provider.authenticate).toHaveBeenCalledWith(request);
  });
});
