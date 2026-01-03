/**
 * OAuth in-memory storage with TTL
 */

import type {
  AuthorizationCodeEntry,
  PKCEPendingEntry,
  DCRClientEntry,
} from "./types.js";

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const PKCE_PENDING_TTL_MS = 10 * 60 * 1000;

class OAuthStorage {
  private authorizationCodes = new Map<string, AuthorizationCodeEntry>();
  private pkcePending = new Map<string, PKCEPendingEntry>();
  private dcrClients = new Map<string, DCRClientEntry>();

  storeAuthorizationCode(entry: AuthorizationCodeEntry): void {
    this.authorizationCodes.set(entry.code, entry);
  }

  consumeAuthorizationCode(code: string): AuthorizationCodeEntry | undefined {
    const entry = this.authorizationCodes.get(code);
    if (entry) {
      this.authorizationCodes.delete(code);
      if (Date.now() > entry.expiresAt) return undefined;
    }
    return entry;
  }

  storePKCEPending(entry: PKCEPendingEntry): void {
    this.pkcePending.set(entry.internalState, entry);
  }

  consumePKCEPending(internalState: string): PKCEPendingEntry | undefined {
    const entry = this.pkcePending.get(internalState);
    if (entry) {
      this.pkcePending.delete(internalState);
      if (Date.now() > entry.expiresAt) return undefined;
    }
    return entry;
  }

  registerClient(client: DCRClientEntry): void {
    this.dcrClients.set(client.clientId, client);
  }

  getClient(clientId: string): DCRClientEntry | undefined {
    return this.dcrClients.get(clientId);
  }

  isValidClient(clientId: string): boolean {
    return this.dcrClients.has(clientId);
  }

  isValidRedirectUri(clientId: string, redirectUri: string): boolean {
    const client = this.dcrClients.get(clientId);
    if (!client) {
      try {
        const url = new URL(redirectUri);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1";
      } catch {
        return false;
      }
    }
    return client.redirectUris.includes(redirectUri);
  }

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

  getStats() {
    return {
      authorizationCodes: this.authorizationCodes.size,
      pkcePending: this.pkcePending.size,
      dcrClients: this.dcrClients.size,
    };
  }
}

export function createAuthCodeEntry(
  params: Omit<AuthorizationCodeEntry, "createdAt" | "expiresAt">
): AuthorizationCodeEntry {
  const now = Date.now();
  return { ...params, createdAt: now, expiresAt: now + AUTH_CODE_TTL_MS };
}

export function createPKCEPendingEntry(
  params: Omit<PKCEPendingEntry, "createdAt" | "expiresAt">
): PKCEPendingEntry {
  const now = Date.now();
  return { ...params, createdAt: now, expiresAt: now + PKCE_PENDING_TTL_MS };
}

export const oauthStorage = new OAuthStorage();
export type { OAuthStorage };
