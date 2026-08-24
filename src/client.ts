import { AuthError } from "./types.js";
import { TokenManager } from "./token.js";

/**
 * `Retry-After` is either a delay in seconds or an HTTP-date; both are
 * normalised to whole seconds. Returns undefined when absent or unparsable.
 */
function parseRetryAfter(value: string | null): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));

  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));

  return undefined;
}

export class HttpClient {
  private baseUrl: string;
  private appSlug: string;
  public tokens: TokenManager;

  constructor(appSlug: string, baseUrl: string, tokens: TokenManager) {
    this.appSlug = appSlug;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.tokens = tokens;
  }

  private url(path: string): string {
    return `${this.baseUrl}/v1/${this.appSlug}${path}`;
  }

  async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      auth?: boolean;
      timeout?: number;
    }
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (options?.auth !== false) {
      const token = this.tokens.getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timeoutMs = options?.timeout ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(this.url(path), {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!resp.ok) {
        let message = `Request failed with status ${resp.status}`;
        let code = "request_failed";
        try {
          const err = await resp.json();
          if (err.error) message = err.error;
          if (err.code) code = err.code;
        } catch {
          // response wasn't JSON
        }
        throw new AuthError(message, resp.status, code, parseRetryAfter(resp.headers.get("Retry-After")));
      }

      return (await resp.json()) as T;
    } catch (err) {
      if (err instanceof AuthError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new AuthError("Request timed out", 408, "timeout");
      }
      throw new AuthError(
        err instanceof Error ? err.message : "Network error",
        0,
        "network_error"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  post<T>(path: string, body?: unknown, auth = false): Promise<T> {
    return this.request<T>("POST", path, { body, auth });
  }

  get<T>(path: string, auth = true): Promise<T> {
    return this.request<T>("GET", path, { auth });
  }

  patch<T>(path: string, body: unknown, auth = true): Promise<T> {
    return this.request<T>("PATCH", path, { body, auth });
  }

  del<T>(path: string, body?: unknown, auth = true): Promise<T> {
    return this.request<T>("DELETE", path, { body, auth });
  }
}
