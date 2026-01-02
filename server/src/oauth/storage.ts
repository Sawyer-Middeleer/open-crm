/**
 * OAuth In-Memory Storage
 *
 * Stores authorization codes, PKCE pending entries, and DCR clients.
 * Uses TTL-based expiration for temporary entries.
 */

import type {
  AuthorizationCodeEntry,
  PKCEPendingEntry,
  DCRClientEntry,
} from "./types.js";

/** Default TTL for authorization codes (10 minutes) */
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

/** Default TTL for PKCE pending entries (10 minutes) */
const PKCE_PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * OAuth storage for authorization codes, PKCE state, and DCR clients.
 */
class OAuthStorage {
  /** Authorization codes keyed by code string */
  private authorizationCodes = new Map<string, AuthorizationCodeEntry>();

  /** PKCE pending entries keyed by internal state */
  private pkcePending = new Map<string, PKCEPendingEntry>();

  /** DCR clients keyed by client_id */
  private dcrClients = new Map<string, DCRClientEntry>();

  /**
   * Store an authorization code entry
   */
  storeAuthorizationCode(entry: AuthorizationCodeEntry): void {
    this.authorizationCodes.set(entry.code, entry);
  }

  /**
   * Get and delete an authorization code (single use)
   */
  consumeAuthorizationCode(code: string): AuthorizationCodeEntry | undefined {
    const entry = this.authorizationCodes.get(code);
    if (entry) {
      this.authorizationCodes.delete(code);
      // Check expiration
      if (Date.now() > entry.expiresAt) {
        return undefined;
      }
    }
    return entry;
  }

  /**
   * Store a PKCE pending entry
   */
  storePKCEPending(entry: PKCEPendingEntry): void {
    this.pkcePending.set(entry.internalState, entry);
  }

  /**
   * Get and delete a PKCE pending entry (single use)
   */
  consumePKCEPending(internalState: string): PKCEPendingEntry | undefined {
    const entry = this.pkcePending.get(internalState);
    if (entry) {
      this.pkcePending.delete(internalState);
      // Check expiration
      if (Date.now() > entry.expiresAt) {
        return undefined;
      }
    }
    return entry;
  }

  /**
   * Register a DCR client
   */
  registerClient(client: DCRClientEntry): void {
    this.dcrClients.set(client.clientId, client);
  }

  /**
   * Get a DCR client by ID
   */
  getClient(clientId: string): DCRClientEntry | undefined {
    return this.dcrClients.get(clientId);
  }

  /**
   * Check if a client ID exists (either DCR registered or built-in)
   */
  isValidClient(clientId: string): boolean {
    return this.dcrClients.has(clientId);
  }

  /**
   * Validate redirect URI for a client
   */
  isValidRedirectUri(clientId: string, redirectUri: string): boolean {
    const client = this.dcrClients.get(clientId);
    if (!client) {
      // For unregistered clients, allow localhost redirect URIs
      // This enables MCP clients to work without explicit DCR
      try {
        const url = new URL(redirectUri);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1";
      } catch {
        return false;
      }
    }
    return client.redirectUris.includes(redirectUri);
  }

  /**
   * Clean up expired entries.
   * Should be called periodically (e.g., every 5 minutes).
   */
  cleanup(): { authCodes: number; pkcePending: number } {
    const now = Date.now();
    let authCodes = 0;
    let pkcePending = 0;

    for (const [code, entry] of this.authorizationCodes) {
      if (now > entry.expiresAt) {
        this.authorizationCodes.delete(code);
        authCodes++;
      }
    }

    for (const [state, entry] of this.pkcePending) {
      if (now > entry.expiresAt) {
        this.pkcePending.delete(state);
        pkcePending++;
      }
    }

    return { authCodes, pkcePending };
  }

  /**
   * Get storage stats for debugging
   */
  getStats(): {
    authorizationCodes: number;
    pkcePending: number;
    dcrClients: number;
  } {
    return {
      authorizationCodes: this.authorizationCodes.size,
      pkcePending: this.pkcePending.size,
      dcrClients: this.dcrClients.size,
    };
  }
}

/**
 * Create a new authorization code entry with default TTL
 */
export function createAuthCodeEntry(
  params: Omit<AuthorizationCodeEntry, "createdAt" | "expiresAt">
): AuthorizationCodeEntry {
  const now = Date.now();
  return {
    ...params,
    createdAt: now,
    expiresAt: now + AUTH_CODE_TTL_MS,
  };
}

/**
 * Create a new PKCE pending entry with default TTL
 */
export function createPKCEPendingEntry(
  params: Omit<PKCEPendingEntry, "createdAt" | "expiresAt">
): PKCEPendingEntry {
  const now = Date.now();
  return {
    ...params,
    createdAt: now,
    expiresAt: now + PKCE_PENDING_TTL_MS,
  };
}

/** Singleton instance */
export const oauthStorage = new OAuthStorage();

export type { OAuthStorage };
