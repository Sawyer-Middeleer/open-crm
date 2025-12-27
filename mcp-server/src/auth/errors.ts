/**
 * Authentication error with HTTP status code
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401,
    public readonly provider?: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Build WWW-Authenticate header value
 */
export function buildWwwAuthenticateHeader(resourceUri?: string): string {
  const parts: string[] = [];

  // Bearer scheme for OAuth
  if (resourceUri) {
    parts.push(
      `Bearer realm="Agent CRM", resource_metadata="${resourceUri}/.well-known/oauth-protected-resource"`
    );
  } else {
    parts.push('Bearer realm="Agent CRM"');
  }

  // API Key scheme
  parts.push("ApiKey");

  return parts.join(", ");
}

/**
 * Create unauthorized response
 */
export function createUnauthorizedResponse(
  message: string,
  resourceUri?: string
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
        "WWW-Authenticate": buildWwwAuthenticateHeader(resourceUri),
      },
    }
  );
}

/**
 * Create forbidden response (authenticated but not authorized)
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
