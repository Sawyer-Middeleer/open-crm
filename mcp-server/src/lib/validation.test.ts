import { describe, test, expect } from "bun:test";
import {
  validateUrl,
  validateUrlPattern,
  isBlockedHost,
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
    expect(result.error).toContain("Localhost");
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
    expect(result.error).toContain("metadata");
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

  // New tests for extended blocking
  test("blocks IPv6 loopback ::1", () => {
    const result = validateUrl("http://[::1]:8080");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6");
  });

  test("blocks IPv6-mapped IPv4 loopback", () => {
    const result = validateUrl("http://[::ffff:127.0.0.1]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6-mapped");
  });

  test("blocks IPv6-mapped private IP - 10.x.x.x", () => {
    const result = validateUrl("http://[::ffff:10.0.0.1]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6-mapped");
  });

  test("blocks IPv6-mapped private IP - 172.16.x.x", () => {
    const result = validateUrl("http://[::ffff:172.16.0.1]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6-mapped");
  });

  test("blocks IPv6-mapped private IP - 192.168.x.x", () => {
    const result = validateUrl("http://[::ffff:192.168.1.1]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6-mapped");
  });

  test("blocks IPv6-mapped link-local", () => {
    const result = validateUrl("http://[::ffff:169.254.169.254]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6-mapped");
  });

  test("blocks link-local IPv6 fe80:", () => {
    const result = validateUrl("http://[fe80::1]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6");
  });

  test("blocks unique local address fd00:", () => {
    const result = validateUrl("http://[fd00::1]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6");
  });

  test("blocks AWS EC2 IPv6 metadata", () => {
    const result = validateUrl("http://[fd00:ec2::254]");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Private IPv6");
  });

  test("blocks Azure alternate metadata IP", () => {
    const result = validateUrl("http://169.254.169.253");
    expect(result.valid).toBe(false);
    // Caught by IPv4 link-local pattern (169.254.x.x)
    expect(result.error).toContain("Private");
  });

  test("blocks Alibaba Cloud metadata IP", () => {
    const result = validateUrl("http://100.100.100.200");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("metadata");
  });

  test("blocks Alibaba Cloud metadata hostname", () => {
    const result = validateUrl("http://metadata.alibaba.com");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("metadata");
  });

  test("blocks metadata.internal hostname", () => {
    const result = validateUrl("http://metadata.internal");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("metadata");
  });

  test("blocks URL with userinfo (username/password bypass)", () => {
    const result = validateUrl("http://user:pass@example.com");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("userinfo");
  });

  test("blocks .localhost subdomains", () => {
    const result = validateUrl("http://evil.localhost");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Localhost");
  });
});

describe("isBlockedHost", () => {
  test("blocks IPv4 loopback", () => {
    expect(isBlockedHost("127.0.0.1").blocked).toBe(true);
    expect(isBlockedHost("127.255.255.255").blocked).toBe(true);
  });

  test("blocks private IPv4 ranges", () => {
    expect(isBlockedHost("10.0.0.1").blocked).toBe(true);
    expect(isBlockedHost("172.16.0.1").blocked).toBe(true);
    expect(isBlockedHost("172.31.255.255").blocked).toBe(true);
    expect(isBlockedHost("192.168.1.1").blocked).toBe(true);
  });

  test("allows public IPv4 ranges", () => {
    expect(isBlockedHost("8.8.8.8").blocked).toBe(false);
    expect(isBlockedHost("172.15.0.1").blocked).toBe(false); // Just outside 172.16.0.0/12
    expect(isBlockedHost("172.32.0.1").blocked).toBe(false); // Just outside 172.16.0.0/12
  });

  test("blocks IPv6 loopback variants", () => {
    expect(isBlockedHost("::1").blocked).toBe(true);
    expect(isBlockedHost("[::1]").blocked).toBe(true);
    expect(isBlockedHost("0:0:0:0:0:0:0:1").blocked).toBe(true);
  });

  test("blocks IPv6-mapped IPv4 private addresses (decimal notation)", () => {
    expect(isBlockedHost("::ffff:127.0.0.1").blocked).toBe(true);
    expect(isBlockedHost("::ffff:10.0.0.1").blocked).toBe(true);
    expect(isBlockedHost("::ffff:172.16.0.1").blocked).toBe(true);
    expect(isBlockedHost("::ffff:192.168.1.1").blocked).toBe(true);
    expect(isBlockedHost("::ffff:169.254.169.254").blocked).toBe(true);
  });

  test("blocks IPv6-mapped IPv4 private addresses (hex notation)", () => {
    // These are the URL-parsed forms of the above addresses
    expect(isBlockedHost("::ffff:7f00:1").blocked).toBe(true); // 127.0.0.1
    expect(isBlockedHost("::ffff:a00:1").blocked).toBe(true); // 10.0.0.1
    expect(isBlockedHost("::ffff:ac10:1").blocked).toBe(true); // 172.16.0.1
    expect(isBlockedHost("::ffff:c0a8:101").blocked).toBe(true); // 192.168.1.1
    expect(isBlockedHost("::ffff:a9fe:a9fe").blocked).toBe(true); // 169.254.169.254
  });

  test("blocks cloud metadata IPs", () => {
    expect(isBlockedHost("169.254.169.254").blocked).toBe(true);
    expect(isBlockedHost("169.254.169.253").blocked).toBe(true);
    expect(isBlockedHost("100.100.100.200").blocked).toBe(true);
  });

  test("blocks cloud metadata hostnames", () => {
    expect(isBlockedHost("metadata.google.internal").blocked).toBe(true);
    expect(isBlockedHost("metadata.alibaba.com").blocked).toBe(true);
    expect(isBlockedHost("metadata.internal").blocked).toBe(true);
    expect(isBlockedHost("metadata.tencentyun.com").blocked).toBe(true);
  });

  test("blocks localhost and subdomains", () => {
    expect(isBlockedHost("localhost").blocked).toBe(true);
    expect(isBlockedHost("evil.localhost").blocked).toBe(true);
  });

  test("allows public hostnames", () => {
    expect(isBlockedHost("example.com").blocked).toBe(false);
    expect(isBlockedHost("api.example.com").blocked).toBe(false);
  });
});

describe("validateUrlPattern", () => {
  test("allows valid URLs without variables", () => {
    const result = validateUrlPattern("https://api.example.com/webhook");
    expect(result.valid).toBe(true);
    expect(result.requiresRuntimeValidation).toBe(false);
  });

  test("allows URLs with valid variable usage in path", () => {
    const result = validateUrlPattern("https://api.example.com/users/{{userId}}");
    expect(result.valid).toBe(true);
    expect(result.requiresRuntimeValidation).toBe(true);
  });

  test("allows URLs with variables in query string", () => {
    const result = validateUrlPattern("https://api.example.com/search?q={{query}}");
    expect(result.valid).toBe(true);
    expect(result.requiresRuntimeValidation).toBe(true);
  });

  test("flags entire host as variable requiring runtime validation", () => {
    const result = validateUrlPattern("http://{{host}}/path");
    expect(result.valid).toBe(true);
    expect(result.requiresRuntimeValidation).toBe(true);
  });

  test("blocks userinfo bypass attempt with blocked host", () => {
    const result = validateUrlPattern("http://{{var}}@169.254.169.254/");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Blocked");
  });

  test("blocks userinfo bypass with localhost", () => {
    const result = validateUrlPattern("http://{{var}}@localhost/");
    expect(result.valid).toBe(false);
  });

  test("blocks static blocked hosts", () => {
    expect(validateUrlPattern("http://127.0.0.1/").valid).toBe(false);
    expect(validateUrlPattern("http://localhost/").valid).toBe(false);
    expect(validateUrlPattern("http://169.254.169.254/").valid).toBe(false);
  });

  test("blocks non-http protocols", () => {
    const result = validateUrlPattern("ftp://example.com/file");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("http");
  });

  test("blocks file:// protocol", () => {
    const result = validateUrlPattern("file:///etc/passwd");
    expect(result.valid).toBe(false);
  });

  test("rejects URLs without protocol", () => {
    const result = validateUrlPattern("example.com/path");
    expect(result.valid).toBe(false);
  });

  test("allows URLs with port and variables", () => {
    const result = validateUrlPattern("https://api.example.com:8080/v{{version}}/users");
    expect(result.valid).toBe(true);
    expect(result.requiresRuntimeValidation).toBe(true);
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
