import { createMiddleware } from "hono/factory";
import {
  ipLimiter,
  userLimiter,
  createRateLimitResponse,
} from "../../lib/rateLimiter.js";
import type { AuthVariables } from "./auth.js";

/**
 * IP-based rate limit middleware
 * Should be applied before auth middleware to prevent brute force
 */
export const ipRateLimitMiddleware = createMiddleware(async (c, next) => {
  const clientIp =
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  const check = ipLimiter.check(clientIp);

  if (!check.allowed) {
    const response = createRateLimitResponse(check, ipLimiter.limit);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }

  await next();
});

/**
 * User-based rate limit middleware
 * Should be applied after auth middleware to use user ID
 */
export const userRateLimitMiddleware = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const auth = c.get("auth");

  if (auth?.userId) {
    const check = userLimiter.check(auth.userId);

    if (!check.allowed) {
      const response = createRateLimitResponse(check, userLimiter.limit);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    }
  }

  await next();
});
