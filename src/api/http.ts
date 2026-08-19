import { errorMessage } from '../errors';

const USER_AGENT = 'github-repo-stats';

// Minimum gap between live requests - serialized calls alone can still trip
// GitHub's secondary rate limit.
const THROTTLE_MS = 500;

const MAX_ATTEMPTS = 3;
const MAX_RATE_LIMIT_WAITS = 3;
const SECONDARY_LIMIT_WAIT_MS = 60_000;

function apiMessage(bodyText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof parsed.message === 'string'
    ) {
      return parsed.message;
    }
  } catch {
    // Not a JSON body - nothing to extract.
  }
  return null;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly bodyText: string,
  ) {
    const detail = apiMessage(bodyText);
    super(`GitHub API ${status} for ${url}${detail ? ` - ${detail}` : ''}`);
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RetryState {
  attempt: number;
  rateLimitWaits: number;
}

/**
 * The single retry policy: counts the attempt and either backs off
 * (returning true) or reports exhaustion (returning false).
 */
async function nextAttempt(state: RetryState): Promise<boolean> {
  state.attempt++;
  if (state.attempt >= MAX_ATTEMPTS) {
    return false;
  }
  await sleep(2 ** state.attempt * 1000);
  return true;
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

/** Handles a non-ok response: resolves to retry, throws otherwise. */
async function handleFailure(
  response: Response,
  url: string,
  state: RetryState,
): Promise<void> {
  const bodyText = await response.text().catch(() => '');

  // The secondary (abuse) rate limit sometimes arrives as a plain 403
  // with no telling headers - the only signal is in the response body.
  if (response.status === 403 && /secondary rate limit/i.test(bodyText)) {
    if (++state.rateLimitWaits > MAX_RATE_LIMIT_WAITS) {
      throw new RateLimitError(resetDateFromHeaders(response.headers));
    }
    await sleep(SECONDARY_LIMIT_WAIT_MS);
    return;
  }

  throw new HttpError(response.status, url, bodyText);
}

async function parseResult(response: Response): Promise<GetResult> {
  // Some endpoints respond 202 with an empty body while GitHub computes
  // the data - json() would throw there.
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  return { status: response.status, body, headers: response.headers };
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

  /** One request attempt; resolves to null when the loop should retry. */
  async function attempt(
    url: string,
    state: RetryState,
  ): Promise<GetResult | null> {
    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      if (!(await nextAttempt(state))) {
        throw new Error(`Network failed for ${url}: ${errorMessage(error)}`);
      }
      return null;
    }

    if (isPrimaryRateLimited(response)) {
      throw new RateLimitError(resetDateFromHeaders(response.headers));
    }

    // 5xx tends to be transient on GitHub's side; when attempts run out it
    // falls through to handleFailure and surfaces as HttpError.
    if (response.status >= 500 && (await nextAttempt(state))) {
      return null;
    }

    if (!response.ok) {
      await handleFailure(response, url, state);
      return null;
    }

    return parseResult(response);
  }

  async function get(url: string): Promise<GetResult> {
    const state: RetryState = { attempt: 0, rateLimitWaits: 0 };
    while (true) {
      await throttle();
      const result = await attempt(url, state);
      if (result) {
        return result;
      }
    }
  }

  return { get };
}
