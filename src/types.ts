// ==================== Configuration ====================

export interface AuthConfig {
  /** The app slug from your Ghayma auth app */
  appSlug: string;
  /** Base URL of the auth service. Default: https://auth.ghayma.tech */
  baseUrl?: string;
  /** Token storage strategy. Default: "memory" */
  storage?: "memory" | "localStorage";
  /** Auto-refresh tokens before they expire. Default: true */
  autoRefresh?: boolean;
}

// ==================== Auth responses ====================

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  email_verified: boolean;
  provider: "email" | "google" | "github";
  created_at: string;
  last_login_at?: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: User;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// ==================== Request types ====================

export interface RegisterParams {
  email: string;
  password: string;
  name?: string;
}

export interface LoginParams {
  email: string;
  password: string;
}

export interface UpdateUserParams {
  name?: string;
  avatar_url?: string;
  metadata?: Record<string, unknown>;
}

export interface ChangePasswordParams {
  current_password: string;
  new_password: string;
}

export interface ChangeEmailParams {
  new_email: string;
  current_password: string;
}

export interface ChangeEmailResponse {
  message: string;
  expires_at: string;
}

export interface CancelEmailChangeResponse {
  message: string;
}

export interface DeleteAccountParams {
  password?: string;
}

export interface OAuthRedirectParams {
  redirectUri: string;
}

export interface OAuthCallbackParams {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ==================== Events ====================

export type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

export type AuthStateListener = (event: AuthEvent, session: Session | null) => void;

// ==================== Errors ====================

export class AuthError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code ?? "auth_error";
  }
}
