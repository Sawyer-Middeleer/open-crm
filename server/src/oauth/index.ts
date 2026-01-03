/**
 * OAuth Authorization Server Module
 */

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

export {
  oauthStorage,
  createAuthCodeEntry,
  createPKCEPendingEntry,
} from "./storage.js";

export {
  generateCodeVerifier,
  generateState,
  generateAuthorizationCode,
  computeS256Challenge,
  verifyPKCE,
  isValidCodeChallenge,
} from "./pkce.js";

export {
  createOAuthError,
  buildErrorRedirect,
  createErrorRedirectResponse,
  createTokenErrorResponse,
  createDCRErrorResponse,
  createErrorPageResponse,
  ERROR_DESCRIPTIONS,
} from "./errors.js";

export { handleAuthorizationServerMetadata } from "./metadata.js";
export { handleAuthorize } from "./authorize.js";
export { handleCallback } from "./callback.js";
export { handleToken } from "./token.js";
export { handleRegister } from "./register.js";
