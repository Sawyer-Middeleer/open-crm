import { createMiddleware } from "hono/factory";
import type { AuthManager, AuthContext } from "../../auth/index.js";
import { hasScope, AuthError, type Scope } from "../../auth/index.js";

/**
 * Auth context available on Hono context after auth middleware runs
 */
export interface AuthVariables {
  auth: AuthContext;
}

/**
 * Creates auth middleware that validates JWT and checks scope
 *
 * @param authManager - The auth manager instance
 * @param requiredScope - The scope required for this route
 */
export function createAuthMiddleware(
  authManager: AuthManager,
  requiredScope: Scope
) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Convert request headers to simple record
    const headers: Record<string, string | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Authenticate the request
    const authContext = await authManager.authenticate({ headers });

    // Check scope
    if (!hasScope(authContext.scopes ?? [], requiredScope)) {
      throw new AuthError(
        `Insufficient scope: requires ${requiredScope}`,
        403,
        "scope-check",
        "insufficient_scope"
      );
    }

    // Store auth context for route handlers
    c.set("auth", authContext);

    await next();
  });
}

/**
 * Get auth context from Hono context
 * Use in route handlers after auth middleware has run
 */
export function getAuth(c: { get: (key: "auth") => AuthContext }): AuthContext {
  return c.get("auth");
}
