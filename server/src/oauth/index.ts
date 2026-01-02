/**
 * OAuth Authorization Server Module
 *
 * Exports all OAuth AS proxy functionality.
 */

// Types
export type {
  AuthorizationCodeEntry,
  PKCEPendingEntry,
  DCRClientEntry,
  DCRRequest,
  DCRResponse,
  AuthorizationServerMetadata,
  TokenResponse,
  OAuthErrorResponse,
  OAuthErrorCode,
} from "./types.js";

// Storage
export {
  oauthStorage,
  createAuthCodeEntry,
  createPKCEPendingEntry,
} from "./storage.js";

// PKCE utilities
export {
  generateCodeVerifier,
  generateState,
  generateAuthorizationCode,
  computeS256Challenge,
  verifyPKCE,
  isValidCodeChallenge,
} from "./pkce.js";

// Error handling
export {
  createOAuthError,
  buildErrorRedirect,
  createErrorRedirectResponse,
  createTokenErrorResponse,
  createDCRErrorResponse,
  createErrorPageResponse,
  ERROR_DESCRIPTIONS,
} from "./errors.js";

// Endpoint handlers
export { handleAuthorizationServerMetadata } from "./metadata.js";
export { handleAuthorize } from "./authorize.js";
export { handleCallback } from "./callback.js";
export { handleToken } from "./token.js";
export { handleRegister } from "./register.js";
