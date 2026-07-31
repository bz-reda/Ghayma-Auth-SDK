// Test helpers — stub `fetch` and record what the SDK actually sends.
// Tests import the BUILT output (dist/) so they verify the shipped artifact.

const BASE_URL = "https://auth.test.local";
const APP_SLUG = "testapp";

/**
 * Replace global fetch with a recorder. `routes` maps a path suffix
 * (e.g. "/2fa/disable") to a response body or a function returning one.
 * Returns the array of recorded requests.
 */
export function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(`/v1/${APP_SLUG}`, "");
    const call = {
      url,
      path,
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const route = routes[path];
    if (route === undefined) {
      throw new Error(`unexpected request to ${path}`);
    }
    const { status = 200, ...body } =
      typeof route === "function" ? route(call) : route;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

/** Authorization header of a recorded request (undefined when absent). */
export function authHeader(call) {
  return call.headers["Authorization"];
}

/** A login response that establishes a session. */
export function sessionResponse(accessToken = "access-1", expiresIn = 3600) {
  return {
    access_token: accessToken,
    refresh_token: "refresh-1",
    expires_in: expiresIn,
    token_type: "Bearer",
    user: { id: "u1", email: "user@test.local" },
  };
}

export { BASE_URL, APP_SLUG };
