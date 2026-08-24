import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GhaymaAuth, AuthError } from "../dist/index.js";
import { APP_SLUG, BASE_URL, sessionResponse, stubFetch } from "./helpers.mjs";

const KEY = `ghs_${"a".repeat(48)}`;
const OTHER_KEY = `ghs_${"b".repeat(48)}`;
const SCOPED_ENV = `ESPACETECH_AUTH_SERVER_KEY_${APP_SLUG.toUpperCase()}`;
const BARE_ENV = "ESPACETECH_AUTH_SERVER_KEY";
const EMAIL = "user@test.local";

/** Env and the simulated browser global leak between tests otherwise. */
function reset() {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith(BARE_ENV)) delete process.env[name];
  }
  delete globalThis.window;
}

beforeEach(reset);
afterEach(reset);

function newClient(config = {}) {
  return new GhaymaAuth({
    appSlug: APP_SLUG,
    baseUrl: BASE_URL,
    autoRefresh: false,
    ...config,
  });
}

/** Headers of the /register call a client with `config` actually sends. */
async function registerHeaders(config = {}, options) {
  const calls = stubFetch(
    { "/register": sessionResponse() },
    config.appSlug ?? APP_SLUG
  );
  const auth = newClient(config);
  await auth.register({ email: EMAIL, password: "securepass123" }, options);
  return calls[0].headers;
}

const serverKeyHeader = (headers) => headers["X-Ghayma-Server-Key"];
const clientIpHeader = (headers) => headers["X-Ghayma-Client-IP"];

// ==================== Server key resolution ====================
// Ghayma injects the key into hosted pods as ESPACETECH_AUTH_SERVER_KEY_<SLUG>,
// plus the bare name when the project has exactly one auth app.

describe("server key resolution (Node)", () => {
  test("explicit option wins over both env vars", async () => {
    process.env[SCOPED_ENV] = OTHER_KEY;
    process.env[BARE_ENV] = OTHER_KEY;

    const headers = await registerHeaders({ serverKey: KEY }, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), KEY);
  });

  test("picks up the slug-scoped env var", async () => {
    process.env[SCOPED_ENV] = KEY;

    const headers = await registerHeaders({}, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), KEY);
  });

  test("the slug-scoped var beats the bare one", async () => {
    process.env[SCOPED_ENV] = KEY;
    process.env[BARE_ENV] = OTHER_KEY;

    const headers = await registerHeaders({}, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), KEY);
  });

  test("falls back to the bare env var", async () => {
    process.env[BARE_ENV] = KEY;

    const headers = await registerHeaders({}, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), KEY);
  });

  test("an empty slug-scoped var is treated as unset", async () => {
    process.env[SCOPED_ENV] = "";
    process.env[BARE_ENV] = KEY;

    const headers = await registerHeaders({}, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), KEY);
  });

  test("non-alphanumeric slug characters become underscores", async () => {
    process.env["ESPACETECH_AUTH_SERVER_KEY_MY_APP_2"] = KEY;

    const headers = await registerHeaders({ appSlug: "my-app.2" }, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), KEY);
  });

  test("no key configured means no headers at all", async () => {
    const headers = await registerHeaders({}, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), undefined);
    assert.equal(clientIpHeader(headers), undefined);
  });
});

// ==================== Browser guard ====================
// The key is a secret that lets its holder pick whose rate-limit bucket a
// request lands in — it must never reach a browser bundle.

describe("browser guard", () => {
  test("passing a serverKey in a browser throws at construction", () => {
    globalThis.window = {};

    assert.throws(
      () => newClient({ serverKey: KEY }),
      /never ship to browsers/
    );
  });

  test("a browser never reads the key out of the environment", async () => {
    process.env[SCOPED_ENV] = KEY;
    process.env[BARE_ENV] = KEY;
    globalThis.window = {};

    const headers = await registerHeaders({}, { clientIp: "1.2.3.4" });

    assert.equal(serverKeyHeader(headers), undefined);
    assert.equal(clientIpHeader(headers), undefined);
  });

  test("a browser client without a serverKey still works", async () => {
    globalThis.window = {};

    const headers = await registerHeaders();

    assert.equal(headers["Content-Type"], "application/json");
  });
});

// ==================== Forwarding rules ====================
// Both headers travel together: a forwarded IP is only honoured from a caller
// that proves itself with the key, and the key alone buys nothing.

describe("IP forwarding", () => {
  test("sends both headers when key and IP are present", async () => {
    const headers = await registerHeaders({ serverKey: KEY }, { clientIp: "203.0.113.7" });

    assert.equal(serverKeyHeader(headers), KEY);
    assert.equal(clientIpHeader(headers), "203.0.113.7");
  });

  test("sends neither header when no clientIp is given", async () => {
    const headers = await registerHeaders({ serverKey: KEY });

    assert.equal(serverKeyHeader(headers), undefined);
    assert.equal(clientIpHeader(headers), undefined);
  });

  test("sends neither header when there is no server key", async () => {
    const headers = await registerHeaders({}, { clientIp: "203.0.113.7" });

    assert.equal(serverKeyHeader(headers), undefined);
    assert.equal(clientIpHeader(headers), undefined);
  });

  test("forwards an IPv6 literal", async () => {
    const headers = await registerHeaders({ serverKey: KEY }, { clientIp: "2001:db8::1" });

    assert.equal(clientIpHeader(headers), "2001:db8::1");
  });

  test("trims surrounding whitespace", async () => {
    const headers = await registerHeaders({ serverKey: KEY }, { clientIp: "  203.0.113.7 " });

    assert.equal(clientIpHeader(headers), "203.0.113.7");
  });

  test("drops a whole x-forwarded-for chain instead of forwarding it", async () => {
    const headers = await registerHeaders(
      { serverKey: KEY },
      { clientIp: "203.0.113.7, 70.41.3.18" }
    );

    assert.equal(serverKeyHeader(headers), undefined);
    assert.equal(clientIpHeader(headers), undefined);
  });

  test("drops a non-IP placeholder", async () => {
    const headers = await registerHeaders({ serverKey: KEY }, { clientIp: "unknown" });

    assert.equal(clientIpHeader(headers), undefined);
  });

  test("an empty clientIp is a no-op", async () => {
    const headers = await registerHeaders({ serverKey: KEY }, { clientIp: "" });

    assert.equal(serverKeyHeader(headers), undefined);
  });
});

// Every operation the auth service rate-limits by IP takes the option.
const IP_LIMITED = [
  ["register", "/register", { email: EMAIL, password: "securepass123" }, sessionResponse()],
  ["login", "/login", { email: EMAIL, password: "securepass123" }, sessionResponse()],
  ["forgotPassword", "/forgot-password", { email: EMAIL }, { message: "sent" }],
  ["resetPassword", "/reset-password", { token: "t", password: "securepass123" }, { message: "ok" }],
  ["verifyResetToken", "/verify-reset-token", { token: "t" }, { valid: true, email: EMAIL }],
  ["resendVerification", "/resend-verification", { email: EMAIL }, { message: "sent" }],
];

describe("IP-limited operations accept clientIp", () => {
  for (const [method, path, params, response] of IP_LIMITED) {
    test(`${method} forwards the caller IP`, async () => {
      const calls = stubFetch({ [path]: response });
      const auth = newClient({ serverKey: KEY });

      await auth[method](params, { clientIp: "203.0.113.7" });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].path, path);
      assert.equal(serverKeyHeader(calls[0].headers), KEY);
      assert.equal(clientIpHeader(calls[0].headers), "203.0.113.7");
    });

    test(`${method} still works without options`, async () => {
      const calls = stubFetch({ [path]: response });
      const auth = newClient({ serverKey: KEY });

      await auth[method](params);

      assert.equal(serverKeyHeader(calls[0].headers), undefined);
    });
  }
});

// ==================== Rate-limit errors ====================

describe("AuthError.retryAfter", () => {
  test("parses Retry-After seconds off a 429", async () => {
    stubFetch({
      "/register": {
        status: 429,
        error: "too many requests",
        code: "rate_limited",
        __headers: { "Retry-After": "30" },
      },
    });
    const auth = newClient();

    await assert.rejects(
      () => auth.register({ email: EMAIL, password: "securepass123" }),
      (err) => {
        assert.ok(err instanceof AuthError);
        assert.equal(err.status, 429);
        assert.equal(err.code, "rate_limited");
        assert.equal(err.retryAfter, 30);
        return true;
      }
    );
  });

  test("parses the HTTP-date form of Retry-After", async () => {
    stubFetch({
      "/register": {
        status: 429,
        error: "too many requests",
        code: "rate_limited",
        __headers: { "Retry-After": new Date(Date.now() + 120_000).toUTCString() },
      },
    });
    const auth = newClient();

    await assert.rejects(
      () => auth.register({ email: EMAIL, password: "securepass123" }),
      (err) => {
        assert.ok(err.retryAfter >= 118 && err.retryAfter <= 121, `got ${err.retryAfter}`);
        return true;
      }
    );
  });

  test("is undefined when the server sends no Retry-After", async () => {
    stubFetch({
      "/login": { status: 401, error: "invalid email or password", code: "invalid_credentials" },
    });
    const auth = newClient();

    await assert.rejects(
      () => auth.login({ email: EMAIL, password: "wrong" }),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.retryAfter, undefined);
        return true;
      }
    );
  });
});
