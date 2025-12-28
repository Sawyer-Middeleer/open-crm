/**
 * In-memory sliding window rate limiter
 * No external dependencies - uses simple fixed window algorithm
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a request should be allowed for the given key
   * @param key - Identifier for rate limiting (IP address, user ID, etc.)
   * @returns Whether the request is allowed and rate limit metadata
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const entry = this.limits.get(key);

    // New window or expired window - start fresh
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.limits.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt: now + this.windowMs,
      };
    }

    // Within window - check if limit exceeded
    if (entry.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.windowStart + this.windowMs,
      };
    }

    // Allow and increment
    entry.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt: entry.windowStart + this.windowMs,
    };
  }

  /**
   * Get the configured limit for this rate limiter
   */
  get limit(): number {
    return this.maxRequests;
  }

  /**
   * Cleanup expired entries to prevent memory leaks
   * Should be called periodically
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.limits) {
      if (now - entry.windowStart >= this.windowMs) {
        this.limits.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Pre-configured rate limiters
// IP limiter: 100 requests per minute (catches auth brute force before auth check)
export const ipLimiter = new RateLimiter(100, 60_000);

// User limiter: 300 requests per minute (allows legitimate heavy usage after auth)
export const userLimiter = new RateLimiter(300, 60_000);

/**
 * Create a 429 Too Many Requests response with standard headers
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  limit: number
): Response {
  const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      error: "Too many requests",
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
      },
    }
  );
}
