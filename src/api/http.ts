const USER_AGENT = 'github-repo-stats';

// Minimum gap between live requests — serialized calls alone can still trip
// GitHub's secondary rate limit.
const THROTTLE_MS = 500;

const MAX_ATTEMPTS = 3;
const MAX_RATE_LIMIT_WAITS = 3;
const SECONDARY_LIMIT_WAIT_MS = 60_000;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly bodyText: string,
  ) {
    super(`GitHub API ${status} for ${url}`);
  }
}

export class RateLimitError extends Error {
  constructor(public readonly resetAt: Date | null) {
    super(
      resetAt
        ? `GitHub API rate limit exhausted, resets at ${resetAt.toISOString()}`
        : 'GitHub API rate limit exhausted',
    );
  }
}

export interface HttpClientOptions {
  token?: string;
}

export interface GetResult {
  status: number;
  body: unknown;
  headers: Headers;
}

export interface HttpClient {
  get(url: string): Promise<GetResult>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPrimaryRateLimited(response: Response): boolean {
  if (response.status !== 403 && response.status !== 429) {
    return false;
  }
  return (
    response.headers.get('x-ratelimit-remaining') === '0' ||
    response.headers.get('retry-after') !== null
  );
}

function resetDateFromHeaders(headers: Headers): Date | null {
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    return new Date(reset * 1000);
  }
  return null;
}

/**
 * Creates a GitHub API client that performs GET requests. The client waits
 * out the secondary (abuse) rate limit, retries transient failures (network,
 * 5xx), and surfaces everything else as typed errors so callers can react
 * per endpoint.
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let lastRequestAt = 0;

  async function throttle(): Promise<void> {
    const wait = lastRequestAt + THROTTLE_MS - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();
  }

  async function get(url: string): Promise<GetResult> {
    let attempt = 0;
    let rateLimitWaits = 0;

    while (true) {
      await throttle();

      let response: Response;
      try {
        response = await fetch(url, { headers });
      } catch (error) {
        attempt++;
        if (attempt >= MAX_ATTEMPTS) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Network failed for ${url}: ${message}`);
        }
        await sleep(2 ** attempt * 1000);
        continue;
      }

      if (isPrimaryRateLimited(response)) {
        throw new RateLimitError(resetDateFromHeaders(response.headers));
      }

      if (response.status >= 500) {
        attempt++;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');

        // The secondary (abuse) rate limit sometimes arrives as a plain 403
        // with no telling headers — the only signal is in the response body.
        if (response.status === 403 && /secondary rate limit/i.test(bodyText)) {
          if (++rateLimitWaits > MAX_RATE_LIMIT_WAITS) {
            throw new RateLimitError(resetDateFromHeaders(response.headers));
          }
          await sleep(SECONDARY_LIMIT_WAIT_MS);
          continue;
        }

        throw new HttpError(response.status, url, bodyText);
      }

      // Some endpoints respond 202 with an empty body while GitHub computes
      // the data — json() would throw there.
      const text = await response.text();
      const body: unknown = text ? JSON.parse(text) : null;
      return { status: response.status, body, headers: response.headers };
    }
  }

  return { get };
}
