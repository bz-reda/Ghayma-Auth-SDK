import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { GhaymaAuth } from "../dist/index.js";
import {
  APP_SLUG,
  BASE_URL,
  authHeader,
  sessionResponse,
  stubFetch,
} from "./helpers.mjs";

function newClient() {
  return new GhaymaAuth({
    appSlug: APP_SLUG,
    baseUrl: BASE_URL,
    autoRefresh: false,
  });
}

/** Sign in so the client holds a session, then drop the login call. */
async function signedIn(calls, auth, accessToken = "access-1") {
  await auth.login({ email: "user@test.local", password: "pw" });
  calls.length = 0;
  return accessToken;
}

// ==================== Finding 6 — JWT-protected routes ====================
// /2fa/disable and /2fa/recovery/regenerate sit in the backend's JWT
// `protected` group: no Authorization header means an unconditional 401.

describe("JWT-protected 2FA routes", () => {
  test("disable2FA sends the Authorization header", async () => {
    const calls = stubFetch({
      "/login": sessionResponse(),
      "/2fa/disable": { message: "2FA disabled" },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    await auth.disable2FA({ password: "pw", code: "123456" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/2fa/disable");
    assert.equal(authHeader(calls[0]), "Bearer access-1");
  });

  test("regenerateRecoveryCodes sends the Authorization header", async () => {
    const calls = stubFetch({
      "/login": sessionResponse(),
      "/2fa/recovery/regenerate": { recovery_codes: ["a", "b"] },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    await auth.regenerateRecoveryCodes({ password: "pw", code: "123456" });

    assert.equal(calls.length, 1);
    assert.equal(authHeader(calls[0]), "Bearer access-1");
  });
});

// ==================== Finding 7 — dual-auth enrolment ====================
// /2fa/totp/enroll and /2fa/totp/confirm are public routes that
// authenticate inside the handler via resolveEnrolIdentity: Bearer JWT
// (voluntary) OR a forced_enroll `enroll_token` in the body (enforced).
// The server reads the Bearer header FIRST and never falls back to the
// enroll_token, so a stale JWT on the enforced path is fatal.

describe("voluntary TOTP enrolment (logged-in user)", () => {
  test("enrollTotp sends the Authorization header", async () => {
    const calls = stubFetch({
      "/login": sessionResponse(),
      "/2fa/totp/enroll": { secret: "S", otpauth_uri: "otpauth://x" },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    const res = await auth.enrollTotp();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/2fa/totp/enroll");
    assert.equal(authHeader(calls[0]), "Bearer access-1");
    assert.equal(res.secret, "S");
  });

  test("confirmTotp sends the Authorization header", async () => {
    const calls = stubFetch({
      "/login": sessionResponse(),
      "/2fa/totp/confirm": { enabled: true, recovery_codes: ["a"] },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    const res = await auth.confirmTotp({ code: "123456" });

    assert.equal(calls.length, 1);
    assert.equal(authHeader(calls[0]), "Bearer access-1");
    assert.deepEqual(res.recovery_codes, ["a"]);
  });

  test("enrollTotp refreshes an expired token before sending it", async () => {
    const calls = stubFetch({
      "/login": sessionResponse("stale-token", 1),
      "/refresh": {
        access_token: "fresh-token",
        refresh_token: "refresh-2",
        expires_in: 3600,
        token_type: "Bearer",
      },
      "/2fa/totp/enroll": { secret: "S", otpauth_uri: "otpauth://x" },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    await auth.enrollTotp();

    assert.deepEqual(
      calls.map((c) => c.path),
      ["/refresh", "/2fa/totp/enroll"]
    );
    assert.equal(authHeader(calls[1]), "Bearer fresh-token");
  });

  test("enrollTotp with neither session nor enroll_token rejects locally", async () => {
    const calls = stubFetch({});
    const auth = newClient();

    await assert.rejects(() => auth.enrollTotp(), /Not authenticated/);
    assert.equal(calls.length, 0);
  });
});

describe("enforced TOTP enrolment (enroll_token, user not logged in)", () => {
  test("enrollTotp sends enroll_token and no Authorization header", async () => {
    const calls = stubFetch({
      "/2fa/totp/enroll": { secret: "S", otpauth_uri: "otpauth://x" },
    });
    const auth = newClient();

    await auth.enrollTotp({ enroll_token: "et-1" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.enroll_token, "et-1");
    assert.equal(authHeader(calls[0]), undefined);
  });

  test("confirmTotp sends enroll_token, no Authorization, and stores the session", async () => {
    const calls = stubFetch({
      "/2fa/totp/confirm": {
        enabled: true,
        recovery_codes: ["a"],
        ...sessionResponse("post-enrol-token"),
      },
    });
    const auth = newClient();

    await auth.confirmTotp({ code: "123456", enroll_token: "et-1" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.enroll_token, "et-1");
    assert.equal(authHeader(calls[0]), undefined);
    assert.equal(auth.isAuthenticated(), true);
    assert.equal(auth.getAccessToken(), "post-enrol-token");
  });

  // The trap: a leftover session (previous login on the same browser —
  // login() returns the pending-2FA shape without clearing it) must not
  // poison the enforced path. The server would take the Bearer branch,
  // resolve the wrong user, or 401 on a stale token.
  test("enrollTotp does not attach a leftover JWT when enroll_token is given", async () => {
    const calls = stubFetch({
      "/login": sessionResponse("other-user-token"),
      "/2fa/totp/enroll": { secret: "S", otpauth_uri: "otpauth://x" },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    await auth.enrollTotp({ enroll_token: "et-1" });

    assert.equal(authHeader(calls[0]), undefined);
  });

  test("confirmTotp does not attach a leftover JWT when enroll_token is given", async () => {
    const calls = stubFetch({
      "/login": sessionResponse("other-user-token"),
      "/2fa/totp/confirm": { enabled: true, recovery_codes: ["a"] },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    await auth.confirmTotp({ code: "123456", enroll_token: "et-1" });

    assert.equal(authHeader(calls[0]), undefined);
  });

  test("enforced enrolment works with an expired leftover session (no refresh, no throw)", async () => {
    const calls = stubFetch({
      "/login": sessionResponse("expired-token", 1),
      "/2fa/totp/enroll": { secret: "S", otpauth_uri: "otpauth://x" },
    });
    const auth = newClient();
    await signedIn(calls, auth);

    await auth.enrollTotp({ enroll_token: "et-1" });

    assert.deepEqual(
      calls.map((c) => c.path),
      ["/2fa/totp/enroll"]
    );
    assert.equal(authHeader(calls[0]), undefined);
  });
});

// ==================== Regression guard — public routes ====================
// Unauthenticated endpoints must stay header-free.

describe("public routes stay unauthenticated", () => {
  test("login and forgotPassword send no Authorization header", async () => {
    const calls = stubFetch({
      "/login": sessionResponse(),
      "/forgot-password": { message: "sent" },
    });
    const auth = newClient();
    await auth.login({ email: "user@test.local", password: "pw" });
    await auth.forgotPassword({ email: "user@test.local" });

    assert.equal(authHeader(calls[0]), undefined);
    assert.equal(authHeader(calls[1]), undefined);
  });
});
