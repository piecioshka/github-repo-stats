import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHttpClient, HttpError, RateLimitError } from './http';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

describe('createHttpClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends GitHub API headers without Authorization when no token is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient().get('https://api.github.com/repos/a/b');
    await vi.runAllTimersAsync();
    await pending;

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Accept).toEqual('application/vnd.github+json');
    expect(headers['User-Agent']).toEqual('github-repo-stats');
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends Authorization header when a token is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient({ token: 'secret' }).get(
      'https://api.github.com/repos/a/b',
    );
    await vi.runAllTimersAsync();
    await pending;

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toEqual('Bearer secret');
  });

  it('returns the parsed body and response headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { name: 'repo' },
          { headers: { link: '<https://x?page=2>; rel="last"' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient().get('https://api.github.com/repos/a/b');
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.body).toEqual({ name: 'repo' });
    expect(result.headers.get('link')).toEqual(
      '<https://x?page=2>; rel="last"',
    );
  });

  it('throws HttpError with the status for a 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'Not Found' }, { status: 404 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient().get('https://api.github.com/repos/a/b');
    pending.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(pending).rejects.toBeInstanceOf(HttpError);
    await expect(pending).rejects.toMatchObject({ status: 404 });
  });

  it('throws RateLimitError with the reset date on an exhausted primary limit', async () => {
    const resetEpochSeconds = Math.floor(Date.now() / 1000) + 1800;
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'API rate limit exceeded' },
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetEpochSeconds),
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient().get('https://api.github.com/repos/a/b');
    pending.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(pending).rejects.toBeInstanceOf(RateLimitError);
    await expect(pending).rejects.toMatchObject({
      resetAt: new Date(resetEpochSeconds * 1000),
    });
  });

  it('waits at least 60s and retries on a secondary rate limit 403', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('You have exceeded a secondary rate limit. Please wait.', {
          status: 403,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient().get('https://api.github.com/repos/a/b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.body).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 500 response and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient().get('https://api.github.com/repos/a/b');
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.body).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = createHttpClient().get('https://api.github.com/repos/a/b');
    pending.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(pending).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
