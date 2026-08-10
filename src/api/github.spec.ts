import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpClient, HttpError } from './http';
import {
  countFromCollection,
  getContributorsCount,
  getFirstCommit,
  getOpenCounts,
  getParticipationCommits,
  getReleases,
  getTraffic,
  summarizeReleases,
} from './github';

function fakeClient(
  routes: Record<string, () => { body: unknown; headers?: Headers }>,
): HttpClient {
  return {
    get: vi.fn(async (url: string) => {
      for (const [fragment, respond] of Object.entries(routes)) {
        if (url.includes(fragment)) {
          const { body, headers } = respond();
          return { status: 200, body, headers: headers ?? new Headers() };
        }
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    }),
  };
}

const REF = { owner: 'a', repo: 'b' };

describe('countFromCollection', () => {
  it('reads the total from the rel="last" page number', () => {
    const headers = new Headers({
      link: '<https://api.github.com/x?per_page=1&page=42>; rel="last", <https://api.github.com/x?per_page=1&page=2>; rel="next"',
    });
    expect(countFromCollection(headers, [{}])).toEqual(42);
  });

  it('falls back to the body length when the Link header is missing', () => {
    expect(countFromCollection(new Headers(), [{}])).toEqual(1);
    expect(countFromCollection(new Headers(), [])).toEqual(0);
  });
});

describe('getOpenCounts', () => {
  it('subtracts pull requests from the issues counter', async () => {
    const client = fakeClient({
      '/issues?': () => ({
        body: [{}],
        headers: new Headers({ link: '<https://x?page=10>; rel="last"' }),
      }),
      '/pulls?': () => ({
        body: [{}],
        headers: new Headers({ link: '<https://x?page=4>; rel="last"' }),
      }),
    });

    const counts = await getOpenCounts(client, REF);
    expect(counts.openPulls).toEqual(4);
    expect(counts.openIssues).toEqual(6);
  });
});

describe('getReleases', () => {
  it('paginates until a page is shorter than the page size', async () => {
    const fullPage = Array.from({ length: 100 }, (unused, index) => ({
      id: index,
    }));
    const responses = [fullPage, [{ id: 100 }]];
    let call = 0;
    const client: HttpClient = {
      get: vi.fn(async () => ({
        status: 200,
        body: responses[call++],
        headers: new Headers(),
      })),
    };

    const releases = await getReleases(client, REF);
    expect(releases).toHaveLength(101);
    expect(client.get).toHaveBeenCalledTimes(2);
  });
});

describe('summarizeReleases', () => {
  it('picks first and latest by created_at instead of API order', () => {
    const releases = [
      { tag_name: 'v2', created_at: '2021-06-01T00:00:00Z', assets: [] },
      { tag_name: 'v3', created_at: '2022-01-01T00:00:00Z', assets: [] },
      { tag_name: 'v1', created_at: '2020-01-01T00:00:00Z', assets: [] },
    ];

    const summary = summarizeReleases(releases);
    expect(summary?.first.tag).toEqual('v1');
    expect(summary?.latest.tag).toEqual('v3');
    expect(summary?.count).toEqual(3);
  });

  it('sums asset downloads across all releases', () => {
    const releases = [
      {
        tag_name: 'v1',
        created_at: '2020-01-01T00:00:00Z',
        assets: [{ download_count: 10 }, { download_count: 5 }],
      },
      {
        tag_name: 'v2',
        created_at: '2021-01-01T00:00:00Z',
        assets: [{ download_count: 1 }],
      },
    ];

    expect(summarizeReleases(releases)?.totalDownloads).toEqual(16);
  });

  it('returns null when there are no releases', () => {
    expect(summarizeReleases([])).toBeNull();
  });
});

describe('getFirstCommit', () => {
  it('follows the rel="last" page to reach the oldest commit', async () => {
    const client = fakeClient({
      'page=3': () => ({
        body: [
          {
            sha: 'oldest-sha',
            commit: {
              author: { name: 'Author', date: '2015-01-01T00:00:00Z' },
            },
          },
        ],
      }),
      '/commits?per_page=1': () => ({
        body: [{ sha: 'newest-sha' }],
        headers: new Headers({
          link: '<https://api.github.com/repos/a/b/commits?per_page=1&page=3>; rel="last"',
        }),
      }),
    });

    const commit = await getFirstCommit(client, REF);
    expect(commit?.sha).toEqual('oldest-sha');
    expect(commit?.authoredAt).toEqual('2015-01-01T00:00:00Z');
    expect(commit?.author).toEqual('Author');
  });

  it('uses the only page when the Link header is missing', async () => {
    const client = fakeClient({
      '/commits?per_page=1': () => ({
        body: [
          {
            sha: 'only-sha',
            commit: { author: { name: 'Solo', date: '2020-05-05T00:00:00Z' } },
          },
        ],
      }),
    });

    const commit = await getFirstCommit(client, REF);
    expect(commit?.sha).toEqual('only-sha');
  });

  it('returns null for an empty repository (409)', async () => {
    const client: HttpClient = {
      get: vi.fn(async (url: string) => {
        throw new HttpError(409, url, 'Git Repository is empty.');
      }),
    };

    expect(await getFirstCommit(client, REF)).toBeNull();
  });
});

describe('getParticipationCommits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries on 202 while GitHub computes the stats', async () => {
    let call = 0;
    const client: HttpClient = {
      get: vi.fn(async () => {
        call++;
        if (call === 1) {
          return { status: 202, body: null, headers: new Headers() };
        }
        return { status: 200, body: { all: [1, 2, 3] }, headers: new Headers() };
      }),
    };

    const pending = getParticipationCommits(client, REF);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(6);
  });

  it('gives up after repeated 202 responses and returns null', async () => {
    const client: HttpClient = {
      get: vi.fn(async () => ({
        status: 202,
        body: null,
        headers: new Headers(),
      })),
    };

    const pending = getParticipationCommits(client, REF);
    await vi.runAllTimersAsync();
    expect(await pending).toBeNull();
    expect(client.get).toHaveBeenCalledTimes(3);
  });
});

describe('getContributorsCount', () => {
  it('reads the count from the Link header', async () => {
    const client = fakeClient({
      '/contributors?': () => ({
        body: [{}],
        headers: new Headers({ link: '<https://x?page=7>; rel="last"' }),
      }),
    });

    expect(await getContributorsCount(client, REF)).toEqual(7);
  });

  it('returns "5000+" when GitHub refuses to list a huge repository', async () => {
    const client: HttpClient = {
      get: vi.fn(async (url: string) => {
        throw new HttpError(
          403,
          url,
          'The history or contributor list is too large to list contributors for this repository via the API.',
        );
      }),
    };

    expect(await getContributorsCount(client, REF)).toEqual('5000+');
  });
});

describe('getTraffic', () => {
  it('reports unavailability on 403 without failing', async () => {
    const client: HttpClient = {
      get: vi.fn(async (url: string) => {
        throw new HttpError(403, url, 'Must have push access to repository');
      }),
    };

    const traffic = await getTraffic(client, REF);
    expect(traffic.available).toEqual(false);
  });

  it('aggregates views, clones, referrers and paths', async () => {
    const client = fakeClient({
      '/traffic/views': () => ({
        body: { count: 100, uniques: 40, views: [] },
      }),
      '/traffic/clones': () => ({
        body: { count: 10, uniques: 5, clones: [] },
      }),
      '/traffic/popular/referrers': () => ({
        body: [{ referrer: 'news.ycombinator.com', count: 50, uniques: 30 }],
      }),
      '/traffic/popular/paths': () => ({
        body: [{ path: '/a/b', title: 'B', count: 20, uniques: 10 }],
      }),
    });

    const traffic = await getTraffic(client, REF);
    expect(traffic.available).toEqual(true);
    if (traffic.available) {
      expect(traffic.views).toEqual({ count: 100, uniques: 40 });
      expect(traffic.clones).toEqual({ count: 10, uniques: 5 });
      expect(traffic.referrers).toHaveLength(1);
      expect(traffic.paths).toHaveLength(1);
    }
  });
});
