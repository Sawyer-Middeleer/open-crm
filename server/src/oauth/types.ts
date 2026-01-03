/**
 * OAuth Authorization Server Types
 */

export interface AuthorizationCodeEntry {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope: string;
  state?: string;
  resource?: string;
  auth0AccessToken: string;
  auth0TokenType: string;
  auth0ExpiresIn: number;
  auth0IdToken?: string;
  auth0RefreshToken?: string;
  createdAt: number;
  expiresAt: number;
}

export interface PKCEPendingEntry {
  internalState: string;
  clientState?: string;
  serverCodeVerifier: string;
  clientCodeChallenge: string;
  codeChallengeMethod: "S256";
  clientId: string;
  redirectUri: string;
  scope: string;
  resource?: string;
  createdAt: number;
  expiresAt: number;
}

export interface DCRClientEntry {
  clientId: string;
  clientSecret: string | null;
  clientName?: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: "none" | "client_secret_basic" | "client_secret_post";
  clientIdIssuedAt: number;
}

export interface DCRRequest {
  redirect_uris: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: "none" | "client_secret_basic" | "client_secret_post";
  scope?: string;
}

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

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  refresh_token?: string;
}

export interface OAuthErrorResponse {
  error: OAuthErrorCode;
  error_description?: string;
  error_uri?: string;
  state?: string;
}

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
  | "invalid_redirect_uri";
