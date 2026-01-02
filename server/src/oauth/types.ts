/**
 * OAuth Authorization Server Types
 *
 * Types for the OAuth AS proxy that sits between MCP clients and Auth0.
 */

/**
 * Authorization code entry stored after Auth0 callback.
 * Contains the tokens from Auth0 and the client's original PKCE challenge.
 */
export interface AuthorizationCodeEntry {
  /** The authorization code issued to the client */
  code: string;
  /** Client ID that requested authorization */
  clientId: string;
  /** Redirect URI for the client */
  redirectUri: string;
  /** Client's PKCE code challenge (to verify at token endpoint) */
  codeChallenge: string;
  /** PKCE method (always S256) */
  codeChallengeMethod: "S256";
  /** Requested scopes */
  scope: string;
  /** Client's original state parameter */
  state?: string;
  /** RFC 8707 resource parameter */
  resource?: string;
  /** Access token from Auth0 */
  auth0AccessToken: string;
  /** Token type from Auth0 (usually "Bearer") */
  auth0TokenType: string;
  /** Expires in seconds from Auth0 */
  auth0ExpiresIn: number;
  /** ID token from Auth0 (if openid scope requested) */
  auth0IdToken?: string;
  /** Refresh token from Auth0 (if offline_access scope) */
  auth0RefreshToken?: string;
  /** When this entry was created */
  createdAt: number;
  /** When this entry expires */
  expiresAt: number;
}

/**
 * Pending PKCE entry stored during the authorization flow.
 * Maps internal state (used with Auth0) to client's PKCE challenge.
 */
export interface PKCEPendingEntry {
  /** Internal state used with Auth0 */
  internalState: string;
  /** Client's original state parameter */
  clientState?: string;
  /** Server's code verifier for Auth0 PKCE */
  serverCodeVerifier: string;
  /** Client's code challenge (to verify later) */
  clientCodeChallenge: string;
  /** PKCE method (always S256) */
  codeChallengeMethod: "S256";
  /** Client ID */
  clientId: string;
  /** Client's redirect URI */
  redirectUri: string;
  /** Requested scopes */
  scope: string;
  /** RFC 8707 resource parameter */
  resource?: string;
  /** When this entry was created */
  createdAt: number;
  /** When this entry expires */
  expiresAt: number;
}

/**
 * DCR client registration entry.
 * Stores client registrations in memory.
 */
export interface DCRClientEntry {
  /** Generated client ID (UUID) */
  clientId: string;
  /** Client secret (only for confidential clients, null for public) */
  clientSecret: string | null;
  /** Human-readable client name */
  clientName?: string;
  /** Registered redirect URIs */
  redirectUris: string[];
  /** Supported grant types */
  grantTypes: string[];
  /** Token endpoint auth method */
  tokenEndpointAuthMethod: "none" | "client_secret_basic" | "client_secret_post";
  /** When this client was registered */
  clientIdIssuedAt: number;
}

/**
 * RFC 7591 DCR request body
 */
export interface DCRRequest {
  redirect_uris: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: "none" | "client_secret_basic" | "client_secret_post";
  scope?: string;
}

/**
 * RFC 7591 DCR response body
 */
export interface DCRResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_name?: string;
}

/**
 * RFC 8414 Authorization Server Metadata
 */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported: string[];
  response_types_supported: string[];
  response_modes_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
  service_documentation?: string;
}

/**
 * OAuth token response
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

/**
 * OAuth error response (RFC 6749)
 */
export interface OAuthErrorResponse {
  error: OAuthErrorCode;
  error_description?: string;
  error_uri?: string;
  state?: string;
}

/**
 * OAuth error codes (RFC 6749)
 */
export type OAuthErrorCode =
  | "invalid_request"
  | "unauthorized_client"
  | "access_denied"
  | "unsupported_response_type"
  | "invalid_scope"
  | "server_error"
  | "temporarily_unavailable"
  | "invalid_grant"
  | "invalid_client"
  | "unsupported_grant_type"
  | "invalid_redirect_uri"; // RFC 7591 DCR error
