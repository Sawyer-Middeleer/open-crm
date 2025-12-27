import { describe, test, expect } from "bun:test";
import {
  validateUrl,
  isNetworkError,
  getCorsHeaders,
  validateAuthContext,
} from "./validation";

describe("validateUrl", () => {
  test("allows valid public URLs", () => {
    expect(validateUrl("https://api.example.com/webhook")).toEqual({
      valid: true,
    });
    expect(validateUrl("http://example.com")).toEqual({ valid: true });
    expect(validateUrl("https://subdomain.example.org:8080/path")).toEqual({
      valid: true,
    });
  });

  test("blocks localhost", () => {
    const result = validateUrl("http://localhost:3000");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private");
  });

  test("blocks 127.0.0.1", () => {
    const result = validateUrl("http://127.0.0.1:8080");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private");
  });

  test("blocks private IPs - 10.x.x.x", () => {
    const result = validateUrl("http://10.0.0.1/api");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private");
  });

  test("blocks private IPs - 172.16.x.x", () => {
    const result = validateUrl("http://172.16.0.1");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private");
  });

  test("blocks private IPs - 192.168.x.x", () => {
    const result = validateUrl("http://192.168.1.1");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private");
  });

  test("blocks AWS metadata - 169.254.169.254", () => {
    const result = validateUrl("http://169.254.169.254/latest/meta-data/");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private");
  });

  test("blocks cloud metadata services", () => {
    const result = validateUrl("http://metadata.google.internal/");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Metadata");
  });

  test("blocks non-http protocols - ftp", () => {
    const result = validateUrl("ftp://example.com/file");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTP(S)");
  });

  test("blocks non-http protocols - file", () => {
    const result = validateUrl("file:///etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTP(S)");
  });

  test("returns error for invalid URLs", () => {
    const result = validateUrl("not a url");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  test("returns error for empty string", () => {
    const result = validateUrl("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });
});

describe("isNetworkError", () => {
  test("returns true for ECONNREFUSED", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:3000");
    expect(isNetworkError(error)).toBe(true);
  });

  test("returns true for ENOTFOUND", () => {
    const error = new Error("getaddrinfo ENOTFOUND example.invalid");
    expect(isNetworkError(error)).toBe(true);
  });

  test("returns true for timeout", () => {
    const error = new Error("Request timeout after 30000ms");
    expect(isNetworkError(error)).toBe(true);
  });

  test("returns true for fetch failed", () => {
    const error = new Error("fetch failed");
    expect(isNetworkError(error)).toBe(true);
  });

  test("returns true for network error", () => {
    const error = new Error("Network error occurred");
    expect(isNetworkError(error)).toBe(true);
  });

  test("returns false for auth errors", () => {
    const error = new Error("Invalid API key");
    expect(isNetworkError(error)).toBe(false);
  });

  test("returns false for generic errors", () => {
    const error = new Error("Something went wrong");
    expect(isNetworkError(error)).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isNetworkError("string error")).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError({ message: "timeout" })).toBe(false);
  });
});

describe("getCorsHeaders", () => {
  test("returns base headers when allowlist is empty", () => {
    const headers = getCorsHeaders("https://example.com", []);
    expect(headers["Access-Control-Allow-Methods"]).toBeDefined();
    expect(headers["Access-Control-Allow-Headers"]).toBeDefined();
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  test("returns origin header when origin is in allowlist", () => {
    const headers = getCorsHeaders("https://app.example.com", [
      "https://app.example.com",
      "https://other.example.com",
    ]);
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "https://app.example.com"
    );
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  test("returns no origin header when origin not in allowlist", () => {
    const headers = getCorsHeaders("https://evil.com", [
      "https://app.example.com",
    ]);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  test("handles null origin", () => {
    const headers = getCorsHeaders(null, ["https://app.example.com"]);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("validateAuthContext", () => {
  test("passes with all required fields", () => {
    const result = validateAuthContext({
      userId: "user123",
      workspaceId: "ws123",
      workspaceMemberId: "wm123",
      role: "admin",
    });
    expect(result.valid).toBe(true);
  });

  test("passes with extra fields", () => {
    const result = validateAuthContext({
      userId: "user123",
      workspaceId: "ws123",
      workspaceMemberId: "wm123",
      role: "admin",
      email: "test@example.com",
      provider: "oauth",
    });
    expect(result.valid).toBe(true);
  });

  test("fails when userId missing", () => {
    const result = validateAuthContext({
      workspaceId: "ws123",
      workspaceMemberId: "wm123",
      role: "admin",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("userId");
  });

  test("fails when workspaceId missing", () => {
    const result = validateAuthContext({
      userId: "user123",
      workspaceMemberId: "wm123",
      role: "admin",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("workspaceId");
  });

  test("fails when workspaceMemberId missing", () => {
    const result = validateAuthContext({
      userId: "user123",
      workspaceId: "ws123",
      role: "admin",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("workspaceMemberId");
  });

  test("fails when role missing", () => {
    const result = validateAuthContext({
      userId: "user123",
      workspaceId: "ws123",
      workspaceMemberId: "wm123",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("role");
  });

  test("fails with null input", () => {
    const result = validateAuthContext(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not an object");
  });

  test("fails with undefined input", () => {
    const result = validateAuthContext(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not an object");
  });

  test("fails with non-object input", () => {
    const result = validateAuthContext("string");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not an object");
  });
});
