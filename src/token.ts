import type { Session, TokenPair } from "./types.js";

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

export class TokenManager {
  private session: StoredSession | null = null;
  // Internal localStorage key — kept unchanged across the Ghayma rebrand so
  // existing end-users of apps built on this SDK stay signed in. Do not rename.
  private storageKey = "espace_auth_session";
  private useLocalStorage: boolean;

  constructor(storage: "memory" | "localStorage" = "memory") {
    this.useLocalStorage = storage === "localStorage" && typeof globalThis.localStorage !== "undefined";
    if (this.useLocalStorage) {
      this.load();
    }
  }

  /** Store tokens from a login/register/refresh response */
  setTokens(tokens: TokenPair): void {
    this.session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    if (this.useLocalStorage) {
      this.persist();
    }
  }

  /** Get the current access token, or null if not authenticated */
  getAccessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  /** Get the current refresh token */
  getRefreshToken(): string | null {
    return this.session?.refreshToken ?? null;
  }

  /** Check if the access token has expired (with a 30-second buffer) */
  isExpired(): boolean {
    if (!this.session) return true;
    return Date.now() >= this.session.expiresAt - 30_000;
  }

  /** Check if there is any session stored (expired or not) */
  hasSession(): boolean {
    return this.session !== null;
  }

  /** Clear all stored tokens */
  clear(): void {
    this.session = null;
    if (this.useLocalStorage) {
      try {
        localStorage.removeItem(this.storageKey);
      } catch {
        // ignore
      }
    }
  }

  /** Milliseconds until the access token expires */
  expiresIn(): number {
    if (!this.session) return 0;
    return Math.max(0, this.session.expiresAt - Date.now());
  }

  private persist(): void {
    if (!this.session) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.session));
    } catch {
      // quota exceeded or unavailable — fall back silently
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        this.session = JSON.parse(raw);
      }
    } catch {
      // corrupted or unavailable
    }
  }
}
