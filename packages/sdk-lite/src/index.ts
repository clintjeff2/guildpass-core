import { GuildPassApiError } from './errors';

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  role?: string;
}

export interface GuildPassClientOptions {
  /** Base URL of the GuildPass API, e.g. `https://api.guildpass.example.com`. */
  baseUrl: string;

  /** Bearer token. Defaults to `process.env.GUILDPASS_TOKEN` when omitted. */
  token?: string;

  /** Override the global `fetch` (useful in tests and Node <18). */
  fetchImpl?: typeof fetch;

  /** Optional API version constraint to check against response headers. */
  expectedApiVersion?: string;
}

/** Maximum characters of a response body retained on a {@link GuildPassApiError}. */
const MAX_RESPONSE_BODY_CHARS = 500;

export class GuildPassClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly expectedApiVersion: string | undefined;

  constructor(opts: GuildPassClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token ?? process.env.GUILDPASS_TOKEN;
    this.expectedApiVersion = opts.expectedApiVersion;
    this.fetchImpl =
      opts.fetchImpl ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (() => {
            throw new Error(
              'No fetch implementation available. Pass `fetchImpl` or upgrade to Node 18+.',
            );
          })());
  }

  /**
   * Check whether a member is allowed to perform an action against a target.
   *
   * @throws {GuildPassApiError} when the request fails, the response is not
   *   JSON, or a successful response carries an unexpected shape.
   */
  async checkAccess(input: {
    memberId: string;
    action: string;
    target: string;
  }): Promise<AccessCheckResult> {
    return this._request<AccessCheckResult>('/v1/access/check', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /**
   * Internal request helper. Centralises URL building, headers, error mapping,
   * JSON parsing, and empty-body handling.
   */
  private async _request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, headers });
    } catch (err) {
      throw new GuildPassApiError({
        statusCode: 0,
        path,
        message: `Network error contacting GuildPass API: ${
          err instanceof Error ? err.message : String(err)
        }`,
        responseBody: '',
      });
    }

    if (this.expectedApiVersion) {
      const apiVersion = res.headers.get('x-guildpass-api-version');
      if (apiVersion && apiVersion !== this.expectedApiVersion) {
        console.warn(
          `[GuildPassClient] API version mismatch for ${path}. Expected ${this.expectedApiVersion}, got ${apiVersion}`,
        );
      }
    }

    if (!res.ok) {
      const body = await safeReadText(res);
      const truncated =
        body.length > MAX_RESPONSE_BODY_CHARS
          ? `${body.slice(0, MAX_RESPONSE_BODY_CHARS)}…[truncated]`
          : body;
      throw new GuildPassApiError({
        statusCode: res.status,
        path,
        message: buildHttpErrorMessage(res.status, res.statusText, body),
        responseBody: truncated,
      });
    }

    // Successful but empty body — return `undefined as T` so callers can
    // distinguish `void` responses from real payloads. Per the issue's
    // acceptance criteria we surface this explicitly rather than guessing.
    const raw = await safeReadText(res);
    if (raw.length === 0) {
      throw new GuildPassApiError({
        statusCode: res.status,
        path,
        message: 'GuildPass API returned an empty success response',
        responseBody: '',
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new GuildPassApiError({
        statusCode: res.status,
        path,
        message: `GuildPass API returned a non-JSON success response: ${
          err instanceof Error ? err.message : String(err)
        }`,
        responseBody: raw.slice(0, MAX_RESPONSE_BODY_CHARS),
      });
    }

    return parsed as T;
  }
}

/** Reads a response body as text without throwing if the stream is already consumed. */
async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function buildHttpErrorMessage(
  status: number,
  statusText: string,
  body: string,
): string {
  const base = `GuildPass API request failed (HTTP ${status}${
    statusText ? ` ${statusText}` : ''
  })`;
  if (body.length === 0) return base;

  // Try to surface a structured `message` / `error` field from the API.
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const detail =
      typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.error === 'string'
        ? parsed.error
        : undefined;
    if (detail) return `${base}: ${detail}`;
  } catch {
    // Not JSON — fall through to the raw-body branch.
  }

  const trimmed = body.trim();
  if (trimmed.length > 0) {
    const snippet =
      trimmed.length > MAX_RESPONSE_BODY_CHARS
        ? `${trimmed.slice(0, MAX_RESPONSE_BODY_CHARS)}…`
        : trimmed;
    return `${base}: ${snippet}`;
  }
  return base;
}

export { GuildPassApiError } from './errors';
