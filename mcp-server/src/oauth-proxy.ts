/**
 * OAuth Proxy Layer for MCP Server
 * 
 * Implements OAuth 2.1 authorization server endpoints that proxy to PropelAuth.
 * This enables Dynamic Client Registration (DCR) for clients like Claude Code.
 */

import type { AuthConfig } from "./auth/config.js";

// In-memory client store (for DCR)
// In production, you'd persist this to a database
const registeredClients = new Map<string, {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  created_at: number;
}>();

// In-memory state store for PKCE/auth flow
const authStates = new Map<string, {
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  created_at: number;
}>();

// Authorization codes (short-lived)
const authCodes = new Map<string, {
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  propelauth_code: string;
  created_at: number;
}>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  const STATE_TTL = 10 * 60 * 1000; // 10 minutes
  const CODE_TTL = 5 * 60 * 1000; // 5 minutes
  
  for (const [key, value] of authStates) {
    if (now - value.created_at > STATE_TTL) authStates.delete(key);
  }
  for (const [key, value] of authCodes) {
    if (now - value.created_at > CODE_TTL) authCodes.delete(key);
  }
}, 60 * 1000);

/**
 * Get the base URL for this server
 */
function getServerBaseUrl(config: AuthConfig): string {
  if (config.resourceUri) {
    // resourceUri is like https://example.com/mcp, we want https://example.com
    return config.resourceUri.replace(/\/mcp$/, "");
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * Handle OAuth Authorization Server Metadata (RFC 8414)
 */
export function handleAuthServerMetadata(config: AuthConfig): Response {
  const baseUrl = getServerBaseUrl(config);
  
  const metadata = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    scopes_supported: ["openid", "profile", "email", "crm:read", "crm:write", "crm:admin"],
  };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "max-age=3600",
    },
  });
}

/**
 * Handle Dynamic Client Registration (RFC 7591)
 */
export async function handleClientRegistration(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json() as {
      redirect_uris?: string[];
      client_name?: string;
      token_endpoint_auth_method?: string;
    };

    // Validate redirect_uris
    if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return new Response(
        JSON.stringify({ error: "invalid_redirect_uri", error_description: "redirect_uris is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate client credentials
    const client_id = `mcp_${crypto.randomUUID().replace(/-/g, "")}`;
    const client_secret = body.token_endpoint_auth_method === "none" 
      ? undefined 
      : crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

    // Store client
    registeredClients.set(client_id, {
      client_id,
      client_secret,
      redirect_uris: body.redirect_uris,
      client_name: body.client_name,
      created_at: Date.now(),
    });

    console.log(`[OAuth] Registered new client: ${client_id} (${body.client_name || "unnamed"})`);

    const response: Record<string, unknown> = {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: client_secret ? "client_secret_post" : "none",
    };

    if (client_secret) {
      response.client_secret = client_secret;
    }
    if (body.client_name) {
      response.client_name = body.client_name;
    }

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle OAuth Authorization Request
 * Redirects to PropelAuth with our credentials
 */
export function handleAuthorize(
  request: Request,
  config: AuthConfig
): Response {
  const url = new URL(request.url);
  const params = url.searchParams;

  const client_id = params.get("client_id");
  const redirect_uri = params.get("redirect_uri");
  const response_type = params.get("response_type");
  const state = params.get("state");
  const code_challenge = params.get("code_challenge");
  const code_challenge_method = params.get("code_challenge_method");

  // Validate required params
  if (!client_id || !redirect_uri || response_type !== "code") {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Missing required parameters" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate client exists and redirect_uri matches
  const client = registeredClients.get(client_id);
  if (!client) {
    return new Response(
      JSON.stringify({ error: "invalid_client", error_description: "Unknown client_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!client.redirect_uris.includes(redirect_uri)) {
    return new Response(
      JSON.stringify({ error: "invalid_redirect_uri", error_description: "redirect_uri not registered" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Generate internal state to track this auth flow
  const internalState = crypto.randomUUID();
  authStates.set(internalState, {
    client_id,
    redirect_uri,
    code_challenge: code_challenge || undefined,
    code_challenge_method: code_challenge_method || undefined,
    state: state || undefined,
    created_at: Date.now(),
  });

  // Build PropelAuth authorization URL
  const propelAuthUrl = config.oauth?.propelAuthUrl;
  const propelClientId = config.oauth?.propelAuthClientId;
  
  if (!propelAuthUrl || !propelClientId) {
    return new Response(
      JSON.stringify({ error: "server_error", error_description: "PropelAuth not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const baseUrl = getServerBaseUrl(config);
  const propelAuthParams = new URLSearchParams({
    client_id: propelClientId,
    redirect_uri: `${baseUrl}/oauth/callback`,
    response_type: "code",
    state: internalState,
    scope: "openid profile email",
  });

  const authUrl = `${propelAuthUrl}/propelauth/oauth/authorize?${propelAuthParams}`;
  
  console.log(`[OAuth] Redirecting to PropelAuth for client ${client_id}`);
  
  return Response.redirect(authUrl, 302);
}

/**
 * Handle OAuth Callback from PropelAuth
 * Exchanges code and redirects back to original client
 */
export async function handleCallback(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const internalState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    console.error(`[OAuth] PropelAuth error: ${error}`);
    return new Response(
      JSON.stringify({ error, error_description: url.searchParams.get("error_description") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!code || !internalState) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Missing code or state" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Look up original auth request
  const authState = authStates.get(internalState);
  if (!authState) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Invalid or expired state" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Clean up state
  authStates.delete(internalState);

  // Generate our own authorization code
  const ourCode = crypto.randomUUID();
  authCodes.set(ourCode, {
    client_id: authState.client_id,
    redirect_uri: authState.redirect_uri,
    code_challenge: authState.code_challenge,
    propelauth_code: code,
    created_at: Date.now(),
  });

  // Redirect back to original client
  const redirectUrl = new URL(authState.redirect_uri);
  redirectUrl.searchParams.set("code", ourCode);
  if (authState.state) {
    redirectUrl.searchParams.set("state", authState.state);
  }

  console.log(`[OAuth] Callback successful, redirecting to client ${authState.client_id}`);
  
  return Response.redirect(redirectUrl.toString(), 302);
}

/**
 * Handle OAuth Token Request
 * Exchanges our code for PropelAuth tokens
 */
export async function handleToken(
  request: Request,
  config: AuthConfig
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const contentType = request.headers.get("content-type") || "";
  let params: URLSearchParams;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await request.text());
  } else if (contentType.includes("application/json")) {
    const body = await request.json() as Record<string, string>;
    params = new URLSearchParams(body);
  } else {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Unsupported content type" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const grant_type = params.get("grant_type");
  const code = params.get("code");
  const client_id = params.get("client_id");
  const redirect_uri = params.get("redirect_uri");
  const code_verifier = params.get("code_verifier");

  if (grant_type !== "authorization_code") {
    return new Response(
      JSON.stringify({ error: "unsupported_grant_type" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!code || !client_id) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Missing code or client_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Look up authorization code
  const authCode = authCodes.get(code);
  if (!authCode) {
    return new Response(
      JSON.stringify({ error: "invalid_grant", error_description: "Invalid or expired code" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate client_id matches
  if (authCode.client_id !== client_id) {
    return new Response(
      JSON.stringify({ error: "invalid_grant", error_description: "client_id mismatch" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate redirect_uri if provided
  if (redirect_uri && authCode.redirect_uri !== redirect_uri) {
    return new Response(
      JSON.stringify({ error: "invalid_grant", error_description: "redirect_uri mismatch" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate PKCE if code_challenge was provided
  if (authCode.code_challenge) {
    if (!code_verifier) {
      return new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "code_verifier required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify code_challenge (S256)
    const encoder = new TextEncoder();
    const data = encoder.encode(code_verifier);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    const computed = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    if (computed !== authCode.code_challenge) {
      return new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "code_verifier invalid" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Exchange PropelAuth code for tokens
  const propelAuthUrl = config.oauth?.propelAuthUrl;
  const propelClientId = config.oauth?.propelAuthClientId;
  const propelClientSecret = config.oauth?.propelAuthClientSecret;
  const baseUrl = getServerBaseUrl(config);

  if (!propelAuthUrl || !propelClientId || !propelClientSecret) {
    return new Response(
      JSON.stringify({ error: "server_error", error_description: "PropelAuth not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const tokenResponse = await fetch(`${propelAuthUrl}/propelauth/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode.propelauth_code,
        client_id: propelClientId,
        client_secret: propelClientSecret,
        redirect_uri: `${baseUrl}/oauth/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error(`[OAuth] PropelAuth token error: ${errorBody}`);
      return new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "Token exchange failed" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Clean up used code
    authCodes.delete(code);

    const tokens = await tokenResponse.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
      id_token?: string;
    };

    console.log(`[OAuth] Token exchange successful for client ${client_id}`);

    return new Response(JSON.stringify(tokens), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[OAuth] Token exchange error:`, err);
    return new Response(
      JSON.stringify({ error: "server_error", error_description: "Token exchange failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

