/**
 * Authentication error with HTTP status code and OAuth error type
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401,
    public readonly provider?: string,
    public readonly oauthError?: "invalid_token" | "insufficient_scope"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Build WWW-Authenticate header value per RFC 6750
 */
export function buildWwwAuthenticateHeader(
  resourceUri?: string,
  error?: "invalid_token" | "insufficient_scope",
  errorDescription?: string,
  requiredScope?: string
): string {
  const params: string[] = ['realm="Open CRM"'];

  if (resourceUri) {
    params.push(
      `resource_metadata="${resourceUri}/.well-known/oauth-protected-resource"`
    );
  }

  if (error) {
    params.push(`error="${error}"`);
  }

  if (errorDescription) {
    params.push(`error_description="${errorDescription}"`);
  }

  if (requiredScope) {
    params.push(`scope="${requiredScope}"`);
  }

  return `Bearer ${params.join(", ")}`;
}

/**
 * Create unauthorized response (401)
 * Used for: missing token, invalid token, expired token
 */
export function createUnauthorizedResponse(
  message: string,
  resourceUri?: string,
  error?: "invalid_token"
): Response {
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      message,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": buildWwwAuthenticateHeader(
          resourceUri,
          error,
          message
        ),
      },
    }
  );
}

/**
 * Create insufficient scope response (403)
 * Used for: valid token but missing required scope
 */
export function createInsufficientScopeResponse(
  requiredScope: string,
  resourceUri?: string
): Response {
  const message = `Insufficient scope: requires ${requiredScope}`;
  return new Response(
    JSON.stringify({
      error: "insufficient_scope",
      message,
      required_scope: requiredScope,
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": buildWwwAuthenticateHeader(
          resourceUri,
          "insufficient_scope",
          message,
          requiredScope
        ),
      },
    }
  );
}

/**
 * Create forbidden response (authenticated but not authorized)
 * Used for: workspace access denied, role-based restrictions
 */
export function createForbiddenResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      error: "forbidden",
      message,
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}
