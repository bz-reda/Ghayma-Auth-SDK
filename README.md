# @ghayma/auth

Client-side authentication SDK for apps built on [Ghayma](https://ghayma.dev). Handles login, registration, token management, OAuth, and user profile — so you don't have to wire up raw HTTP calls.

- Zero dependencies (uses native `fetch`)
- Auto token refresh
- Memory or localStorage persistence
- Auth state events
- Works in browsers, Node.js 18+, Deno, Bun, React Native

## Installation

```bash
npm install github:bz-reda/ETC-Auth-SDK
```

## Quick Start

```typescript
import { GhaymaAuth } from "@ghayma/auth";

const auth = new GhaymaAuth({ appSlug: "my-app" });

// Register
await auth.register({ email: "user@example.com", password: "securepass123", name: "John" });

// Login
const { user } = await auth.login({ email: "user@example.com", password: "securepass123" });

// Get profile (auto-refreshes token if expired)
const me = await auth.getUser();

// Update profile
await auth.updateUser({ name: "John Doe" });

// Logout
await auth.logout();
```

## Configuration

```typescript
const auth = new GhaymaAuth({
  appSlug: "my-app",                               // Required — your Auth App slug
  baseUrl: "https://auth.espace-tech.com",          // Default
  storage: "memory",                                // "memory" (default) or "localStorage"
  autoRefresh: true,                                // Auto-refresh before expiry (default: true)
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `appSlug` | `string` | — | **Required.** Your Auth App slug from the dashboard |
| `baseUrl` | `string` | `https://auth.espace-tech.com` | Auth service base URL |
| `storage` | `"memory" \| "localStorage"` | `"memory"` | Token storage strategy |
| `autoRefresh` | `boolean` | `true` | Auto-refresh tokens before they expire |

### Storage Options

- **`"memory"`** — tokens lost on page refresh. Best for SSR (Next.js, Nuxt) where you manage tokens in cookies server-side.
- **`"localStorage"`** — tokens persist across refreshes. Best for SPAs (React, Vue).

## Authentication

### register(params)

Create a new user account.

```typescript
const session = await auth.register({
  email: "user@example.com",
  password: "securepass123",  // min 8, max 128 chars
  name: "John Doe",           // optional
});
// session.user, session.access_token, session.refresh_token
```

### login(params)

Authenticate an existing user.

```typescript
const session = await auth.login({
  email: "user@example.com",
  password: "securepass123",
});
// session.user, session.access_token, session.expires_in
```

### logout()

Revoke the refresh token and clear the local session.

```typescript
await auth.logout();
```

### refreshToken()

Manually refresh the access token. Called automatically when `autoRefresh` is enabled.

```typescript
const tokens = await auth.refreshToken();
// tokens.access_token, tokens.refresh_token
```

> Refresh tokens are **single-use**. If a revoked token is reused, all sessions for that user are revoked (stolen token protection).

## User Profile

### getUser()

Get the current authenticated user's profile.

```typescript
const user = await auth.getUser();
// user.id, user.email, user.name, user.avatar_url, user.email_verified, user.provider
```

### updateUser(params)

Update the current user's profile. All fields are optional.

```typescript
const updated = await auth.updateUser({
  name: "Jane Doe",
  avatar_url: "https://example.com/photo.jpg",
  metadata: { theme: "dark", lang: "fr" },
});
```

### changePassword(params)

Change the current user's password. Only for email-based accounts.

```typescript
await auth.changePassword({
  current_password: "oldpass123",
  new_password: "newpass456",
});
// All sessions revoked — user must log in again
```

### changeEmail(params)

Request an email change. The server emails a confirmation link to the new address; the change only takes effect when the user clicks that link. The user **stays signed in with their existing email** until confirmation — all refresh tokens are revoked server-side on confirm.

```typescript
const result = await auth.changeEmail({
  new_email: "new@example.com",
  current_password: "currentpass123",
});
// result.message, result.expires_at (ISO timestamp)
```

Rate-limited to 3 requests/hour per user+app. OAuth users (Google, GitHub) cannot change email via this endpoint — they must change it with their identity provider.

### cancelEmailChange()

Cancel a pending email change request.

```typescript
await auth.cancelEmailChange();
```

### deleteAccount(params?)

Permanently delete the current user's account.

```typescript
// Email accounts — password confirmation required
await auth.deleteAccount({ password: "mypassword" });

// OAuth accounts — no password needed
await auth.deleteAccount();
```

## Password Recovery

### forgotPassword(params)

Request a password reset email.

```typescript
await auth.forgotPassword({ email: "user@example.com" });
// Always returns success (prevents email enumeration)
```

### resetPassword(params)

Reset password using the token from the reset email.

```typescript
await auth.resetPassword({
  token: "reset-token-from-email",
  password: "newpassword123",
});
```

### resendVerification(params)

Resend the email verification link.

```typescript
await auth.resendVerification({ email: "user@example.com" });
```

## OAuth

### getGoogleAuthUrl(params)

Get the Google OAuth redirect URL.

```typescript
const url = auth.getGoogleAuthUrl({ redirectUri: "https://myapp.com/callback" });
window.location.href = url;
```

### getGitHubAuthUrl(params)

Get the GitHub OAuth redirect URL.

```typescript
const url = auth.getGitHubAuthUrl({ redirectUri: "https://myapp.com/callback" });
window.location.href = url;
```

### handleOAuthFragment()

Auto-parse tokens from the URL fragment after OAuth redirect. Call this on your callback page.

```typescript
// On your callback page (e.g. /callback)
const success = auth.handleOAuthFragment();
if (success) {
  const user = await auth.getUser();
}
```

### handleOAuthCallback(params)

Manually store tokens if you parse them yourself.

```typescript
auth.handleOAuthCallback({
  accessToken: "eyJ...",
  refreshToken: "rt_...",
  expiresIn: 900,
});
```

## Session State

### isAuthenticated()

Check if the user is currently authenticated.

```typescript
if (auth.isAuthenticated()) {
  // user is logged in
}
```

### getAccessToken()

Get the current access token (or `null`).

```typescript
const token = auth.getAccessToken();
```

### onAuthStateChange(listener)

Subscribe to auth state changes. Returns an unsubscribe function.

```typescript
const unsubscribe = auth.onAuthStateChange((event, session) => {
  // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
  console.log(event);
});

// Stop listening
unsubscribe();
```

## Error Handling

All methods throw `AuthError` on failure:

```typescript
import { GhaymaAuth, AuthError } from "@ghayma/auth";

try {
  await auth.login({ email: "user@example.com", password: "wrong" });
} catch (err) {
  if (err instanceof AuthError) {
    console.error(err.message); // "invalid email or password"
    console.error(err.status);  // 401
    console.error(err.code);    // "auth_error"
  }
}
```

## React Example

```tsx
import { GhaymaAuth } from "@ghayma/auth";

const auth = new GhaymaAuth({ appSlug: "my-app", storage: "localStorage" });

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (auth.isAuthenticated()) {
      auth.getUser().then(setUser).catch(() => setUser(null));
    }
    return auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setUser(null);
    });
  }, []);

  if (!user) return <LoginForm />;
  return <Dashboard user={user} />;
}
```

## Compatibility

Works in any JavaScript runtime with native `fetch`:

- Browsers (Chrome, Firefox, Safari, Edge)
- Node.js 18+
- Deno
- Bun
- React Native

## License

MIT
