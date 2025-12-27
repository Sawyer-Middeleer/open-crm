/**
 * Shared validation utilities for testing
 */

/**
 * Validate URL to prevent SSRF attacks
 * Blocks private IPs, localhost, and cloud metadata services
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    // Only allow http/https
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "Only HTTP(S) protocols allowed" };
    }

    // Block private IPs and localhost
    const host = parsed.hostname.toLowerCase();
    const privatePatterns = [
      /^127\./, // 127.0.0.0/8 (localhost)
      /^10\./, // 10.0.0.0/8
      /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
      /^192\.168\./, // 192.168.0.0/16
      /^0\.0\.0\.0/, // 0.0.0.0
      /^169\.254\./, // Link-local / AWS metadata
      /^localhost$/,
      /^::1$/,
      /^\[::1\]$/,
    ];

    if (privatePatterns.some((p) => p.test(host))) {
      return { valid: false, error: "Private addresses not allowed" };
    }

    // Block cloud metadata services
    const metadataHosts = [
      "metadata.google.internal",
      "metadata.tencentyun.com",
    ];
    if (metadataHosts.includes(host)) {
      return { valid: false, error: "Metadata service access blocked" };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

/**
 * Check if error indicates provider is unavailable (network issue)
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("unreachable")
  );
}

/**
 * Get CORS headers for a request origin
 */
export function getCorsHeaders(
  origin: string | null,
  allowedOrigins: string[]
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-Workspace-Id, Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };

  // If no allowed origins configured, block cross-origin (safe default)
  if (allowedOrigins.length === 0) {
    return headers;
  }

  // Check if origin is in allowlist
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

/**
 * Validate auth context has required fields
 */
export function validateAuthContext(data: unknown): {
  valid: boolean;
  error?: string;
} {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Auth context is not an object" };
  }

  const obj = data as Record<string, unknown>;
  const requiredFields = ["userId", "workspaceId", "workspaceMemberId", "role"];

  for (const field of requiredFields) {
    if (!obj[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  return { valid: true };
}
