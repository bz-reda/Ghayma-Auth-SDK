import { HttpClient } from "./client.js";
import { TokenManager } from "./token.js";
import type {
  AuthConfig,
  AuthEvent,
  AuthStateListener,
  CancelEmailChangeResponse,
  ChangeEmailParams,
  ChangeEmailResponse,
  ChangePasswordParams,
  DeleteAccountParams,
  LoginParams,
  OAuthCallbackParams,
  OAuthRedirectParams,
  RegisterParams,
  Session,
  TokenPair,
  UpdateUserParams,
  User,
} from "./types.js";

export { AuthError } from "./types.js";
export type {
  AuthConfig,
  AuthEvent,
  AuthStateListener,
  CancelEmailChangeResponse,
  ChangeEmailParams,
  ChangeEmailResponse,
  ChangePasswordParams,
  DeleteAccountParams,
  LoginParams,
  OAuthCallbackParams,
  OAuthRedirectParams,
  RegisterParams,
  Session,
  TokenPair,
  UpdateUserParams,
  User,
};

const DEFAULT_BASE_URL = "https://auth.espace-tech.com";

export class GhaymaAuth {
  private http: HttpClient;
  private tokens: TokenManager;
  private listeners: Set<AuthStateListener> = new Set();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRefresh: boolean;
  private appSlug: string;
  private baseUrl: string;

  constructor(config: AuthConfig) {
    if (!config.appSlug) {
      throw new Error("appSlug is required");
    }

    this.appSlug = config.appSlug;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.autoRefresh = config.autoRefresh !== false;
    this.tokens = new TokenManager(config.storage ?? "memory");
    this.http = new HttpClient(this.appSlug, this.baseUrl, this.tokens);

    // If restoring from localStorage with auto-refresh, schedule a refresh
    if (this.tokens.hasSession() && this.autoRefresh) {
      this.scheduleRefresh();
    }
  }

  // ==================== Auth ====================

  /** Register a new user with email and password */
  async register(params: RegisterParams): Promise<Session> {
    const data = await this.http.post<Session>("/register", params);
    if (data.access_token) {
      this.setSession(data, "SIGNED_IN");
    }
    return data;
  }

  /** Log in with email and password */
  async login(params: LoginParams): Promise<Session> {
    const data = await this.http.post<Session>("/login", params);
    this.setSession(data, "SIGNED_IN");
    return data;
  }

  /** Log out and revoke the refresh token */
  async logout(): Promise<void> {
    const refreshToken = this.tokens.getRefreshToken();
    if (refreshToken) {
      try {
        await this.http.post("/logout", { refresh_token: refreshToken });
      } catch {
        // Best effort — clear local state regardless
      }
    }
    this.clearSession();
  }

  /** Refresh the access token using the stored refresh token */
  async refreshToken(): Promise<TokenPair> {
    const refreshToken = this.tokens.getRefreshToken();
    if (!refreshToken) {
      this.clearSession();
      throw new Error("No refresh token available");
    }

    try {
      const data = await this.http.post<TokenPair>("/refresh", {
        refresh_token: refreshToken,
      });
      this.tokens.setTokens(data);
      this.emit("TOKEN_REFRESHED");
      this.scheduleRefresh();
      return data;
    } catch (err) {
      this.clearSession();
      throw err;
    }
  }

  /** Request a password reset email */
  async forgotPassword(params: { email: string }): Promise<{ message: string }> {
    return this.http.post("/forgot-password", params);
  }

  /** Reset password using a token from the reset email */
  async resetPassword(params: { token: string; password: string }): Promise<{ message: string }> {
    return this.http.post("/reset-password", params);
  }

  /** Resend the email verification link */
  async resendVerification(params: { email: string }): Promise<{ message: string }> {
    return this.http.post("/resend-verification", params);
  }

  // ==================== User ====================

  /** Get the current authenticated user's profile */
  async getUser(): Promise<User> {
    await this.ensureToken();
    const data = await this.http.get<{ user: User }>("/me");
    return data.user;
  }

  /** Update the current user's profile */
  async updateUser(params: UpdateUserParams): Promise<User> {
    await this.ensureToken();
    const data = await this.http.patch<{ user: User }>("/me", params);
    this.emit("USER_UPDATED");
    return data.user;
  }

  /** Delete the current user's account */
  async deleteAccount(params?: DeleteAccountParams): Promise<{ message: string }> {
    await this.ensureToken();
    const result = await this.http.del<{ message: string }>("/me", params);
    this.clearSession();
    return result;
  }

  /** Change the current user's password (email accounts only) */
  async changePassword(params: ChangePasswordParams): Promise<{ message: string }> {
    await this.ensureToken();
    const result = await this.http.post<{ message: string }>("/change-password", params, true);
    // All refresh tokens are revoked server-side, clear local session
    this.clearSession();
    return result;
  }

  /**
   * Request an email change for the current user.
   *
   * The server emails a confirmation link to the new address. The change does
   * NOT take effect until the user clicks that link — the user stays signed in
   * with their existing email in the meantime. All refresh tokens are revoked
   * server-side on confirm.
   *
   * @throws {AuthError} 400 — OAuth account (change email via provider), same
   *   email as current, or generic failure (enumeration-masked)
   * @throws {AuthError} 401 — Wrong password
   * @throws {AuthError} 429 — Rate limited (3/hour per user+app)
   */
  async changeEmail(params: ChangeEmailParams): Promise<ChangeEmailResponse> {
    await this.ensureToken();
    return this.http.post<ChangeEmailResponse>("/email/change-request", params, true);
  }

  /**
   * Cancel a pending email change request for the current user.
   *
   * @throws {AuthError} 401 — Not authenticated
   */
  async cancelEmailChange(): Promise<CancelEmailChangeResponse> {
    await this.ensureToken();
    return this.http.del<CancelEmailChangeResponse>("/email/change-request");
  }

  // ==================== OAuth ====================

  /** Get the Google OAuth redirect URL */
  getGoogleAuthUrl(params: OAuthRedirectParams): string {
    const redirectUri = encodeURIComponent(params.redirectUri);
    return `${this.baseUrl}/v1/${this.appSlug}/auth/google?redirect_uri=${redirectUri}`;
  }

  /** Get the GitHub OAuth redirect URL */
  getGitHubAuthUrl(params: OAuthRedirectParams): string {
    const redirectUri = encodeURIComponent(params.redirectUri);
    return `${this.baseUrl}/v1/${this.appSlug}/auth/github?redirect_uri=${redirectUri}`;
  }

  /** Handle the OAuth callback by storing the tokens from the URL fragment */
  handleOAuthCallback(params: OAuthCallbackParams): void {
    const tokenPair: TokenPair = {
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
      expires_in: params.expiresIn,
      token_type: "Bearer",
    };
    this.tokens.setTokens(tokenPair);
    this.emit("SIGNED_IN");
    this.scheduleRefresh();
  }

  /**
   * Parse OAuth tokens from the current URL fragment.
   * Call this on your callback page: `auth.handleOAuthFragment()`
   * Returns true if tokens were found.
   */
  handleOAuthFragment(): boolean {
    if (typeof globalThis.location === "undefined") return false;

    const hash = globalThis.location.hash.substring(1);
    const params = new URLSearchParams(hash);

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = params.get("expires_in");

    if (!accessToken || !refreshToken || !expiresIn) return false;

    this.handleOAuthCallback({
      accessToken,
      refreshToken,
      expiresIn: parseInt(expiresIn, 10),
    });

    // Clean up the URL fragment
    if (typeof globalThis.history !== "undefined") {
      globalThis.history.replaceState(null, "", globalThis.location.pathname + globalThis.location.search);
    }

    return true;
  }

  // ==================== Session state ====================

  /** Check if the user is currently authenticated */
  isAuthenticated(): boolean {
    return this.tokens.hasSession();
  }

  /** Get the current access token (or null) */
  getAccessToken(): string | null {
    return this.tokens.getAccessToken();
  }

  /** Subscribe to auth state changes. Returns an unsubscribe function. */
  onAuthStateChange(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ==================== Internal ====================

  /** Ensure we have a valid access token, refreshing if needed */
  private async ensureToken(): Promise<void> {
    if (!this.tokens.hasSession()) {
      throw new Error("Not authenticated");
    }
    if (this.tokens.isExpired()) {
      await this.refreshToken();
    }
  }

  private setSession(data: Session | TokenPair, event: AuthEvent): void {
    this.tokens.setTokens(data);
    this.emit(event);
    this.scheduleRefresh();
  }

  private clearSession(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.tokens.clear();
    this.emit("SIGNED_OUT");
  }

  private emit(event: AuthEvent): void {
    const session: Session | null = this.tokens.hasSession()
      ? ({
          access_token: this.tokens.getAccessToken()!,
          refresh_token: this.tokens.getRefreshToken()!,
          expires_in: Math.floor(this.tokens.expiresIn() / 1000),
          token_type: "Bearer",
          user: {} as User, // user not always available in events
        } as Session)
      : null;

    for (const listener of this.listeners) {
      try {
        listener(event, session);
      } catch {
        // Don't let listener errors break the SDK
      }
    }
  }

  private scheduleRefresh(): void {
    if (!this.autoRefresh) return;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Refresh 60 seconds before expiry
    const ms = this.tokens.expiresIn() - 60_000;
    if (ms <= 0) return;

    this.refreshTimer = setTimeout(() => {
      this.refreshToken().catch(() => {
        // Refresh failed — session will expire naturally
      });
    }, ms);
  }
}

/** @deprecated use GhaymaAuth */
export { GhaymaAuth as EspaceAuth };
