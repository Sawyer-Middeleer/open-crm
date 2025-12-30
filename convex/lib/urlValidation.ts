/**
 * URL validation utilities for Convex actions
 * Used for runtime SSRF protection when making HTTP requests
 *
 * IMPORTANT: This file is intentionally duplicated with mcp-server/src/lib/validation.ts
 * because Convex backend and MCP server run in separate environments that cannot share code.
 * Any security fixes must be applied to BOTH files. The following functions are synchronized:
 * - normalizeHostname()
 * - isPrivateIPv6Mapped()
 * - isBlockedHost()
 * - validateUrlForFetch() / validateUrl()
 *
 * Note: DNS rebinding attacks are not mitigated by this validation.
 * For complete protection, URLs should be resolved and IPs validated
 * immediately before making requests.
 */

function normalizeHostname(hostname: string): string {
  let normalized = hostname.toLowerCase();

  // Remove brackets from IPv6 addresses
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }

  // Decode URL-encoded characters
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // If decoding fails, use as-is
  }

  return normalized;
}

// Handles both decimal (::ffff:127.0.0.1) and hex (::ffff:7f00:1) notations
function isPrivateIPv6Mapped(host: string): boolean {
  // Match ::ffff: prefix (case insensitive)
  const match = host.match(/^::ffff:(.+)$/i);
  if (!match) return false;

  const suffix = match[1];

  // Decimal notation (::ffff:127.0.0.1)
  if (suffix.includes(".")) {
    const ipv4PrivatePatterns = [
      /^127\./, // 127.0.0.0/8
      /^10\./, // 10.0.0.0/8
      /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
      /^192\.168\./, // 192.168.0.0/16
      /^0\.0\.0\.0$/, // 0.0.0.0
      /^169\.254\./, // Link-local
    ];
    return ipv4PrivatePatterns.some((p) => p.test(suffix));
  }

  // Hex notation (::ffff:7f00:1) - convert to check
  // Format is ::ffff:XXYY:ZZWW where XX.YY.ZZ.WW is the IPv4
  const hexMatch = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;

    // Check if the decoded IPv4 is private
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0 && b === 0 && c === 0 && d === 0) return true; // 0.0.0.0
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
  }

  return false;
}

function isBlockedHost(hostname: string): { blocked: boolean; reason?: string } {
  const host = normalizeHostname(hostname);

  // IPv4 private ranges
  const ipv4PrivatePatterns = [
    /^127\./, // 127.0.0.0/8 (localhost)
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^0\.0\.0\.0/, // 0.0.0.0
    /^169\.254\./, // Link-local / AWS metadata
  ];

  if (ipv4PrivatePatterns.some((p) => p.test(host))) {
    return { blocked: true, reason: "Private IPv4 address not allowed" };
  }

  // IPv6-mapped IPv4 addresses (handles both decimal and hex notations)
  if (isPrivateIPv6Mapped(host)) {
    return { blocked: true, reason: "Private IPv6-mapped address not allowed" };
  }

  // IPv6 patterns
  const ipv6BlockedPatterns = [
    /^::1$/, // IPv6 loopback
    /^0:0:0:0:0:0:0:1$/, // IPv6 loopback (full form)
    /^::$/, // Unspecified address
    /^fe80:/i, // Link-local IPv6
    /^fc00:/i, // Unique local address
    /^fd00:/i, // Unique local address (includes fd00:ec2::254)
    /^fd00:ec2::254$/i, // AWS EC2 IPv6 metadata specifically
  ];

  if (ipv6BlockedPatterns.some((p) => p.test(host))) {
    return { blocked: true, reason: "Private IPv6 address not allowed" };
  }

  // Localhost hostnames
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { blocked: true, reason: "Localhost not allowed" };
  }

  // Cloud metadata services - hostnames
  const metadataHosts = [
    "metadata.google.internal",
    "metadata.tencentyun.com",
    "metadata.alibaba.com",
    "metadata.internal",
    "instance-data", // AWS alternate
  ];

  if (metadataHosts.includes(host) || metadataHosts.some((h) => host.endsWith("." + h))) {
    return { blocked: true, reason: "Cloud metadata service not allowed" };
  }

  // Cloud metadata services - specific IPs
  const metadataIPs = [
    "169.254.169.254", // AWS, Azure, GCP IMDS
    "169.254.169.253", // Azure alternate
    "169.254.169.123", // AWS time service (potential pivot point)
    "100.100.100.200", // Alibaba Cloud metadata
  ];

  if (metadataIPs.includes(host)) {
    return { blocked: true, reason: "Cloud metadata IP not allowed" };
  }

  return { blocked: false };
}

// Must be called AFTER variable interpolation for template URLs
export function validateUrlForFetch(url: string): { valid: boolean; error?: string } {
  try {
    // Decode URL-encoded characters in the full URL before parsing
    let decodedUrl = url;
    try {
      decodedUrl = decodeURIComponent(url);
    } catch {
      // If decoding fails, use original
    }

    const parsed = new URL(decodedUrl);

    // Only allow http/https
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "Only HTTP(S) protocols allowed" };
    }

    // Check if host is blocked
    const hostCheck = isBlockedHost(parsed.hostname);
    if (hostCheck.blocked) {
      return { valid: false, error: hostCheck.reason };
    }

    // Block userinfo in URL (potential bypass vector)
    if (parsed.username || parsed.password) {
      return { valid: false, error: "URL userinfo (username/password) not allowed" };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}
