import { describe, expect, it, vi } from 'vitest';

import { HttpClient, HttpError } from './api/http';
import { collectStats } from './collect';

const REPO_BODY = {
  full_name: 'a/b',
  description: 'Demo',
  html_url: 'https://github.com/a/b',
  language: 'TypeScript',
  license: { name: 'MIT License' },
  created_at: '2020-01-01T00:00:00Z',
  pushed_at: '2023-06-01T00:00:00Z',
  size: 128,
  fork: false,
  private: true,
  archived: false,
  default_branch: 'main',
  topics: ['cli'],
  stargazers_count: 10,
  forks_count: 2,
  subscribers_count: 3,
  open_issues_count: 0,
};

function fakeClient(overrides: Record<string, () => unknown> = {}): HttpClient {
  return {
    get: vi.fn(async (url: string) => {
      for (const [fragment, respond] of Object.entries(overrides)) {
        if (url.includes(fragment)) {
          return { status: 200, body: respond(), headers: new Headers() };
        }
      }
      if (url.includes('/traffic/')) {
        throw new HttpError(403, url, 'Must have push access');
      }
      if (url.includes('/stats/participation')) {
        return { status: 200, body: { all: [1, 2] }, headers: new Headers() };
      }
      if (url.endsWith('/repos/a/b')) {
        return { status: 200, body: REPO_BODY, headers: new Headers() };
      }
      // Collections: issues, pulls, releases, commits, contributors.
      return { status: 200, body: [], headers: new Headers() };
    }),
  };
}

const REF = { owner: 'a', repo: 'b' };

describe('collectStats', () => {
  it('assembles a full report', async () => {
    const report = await collectStats(fakeClient(), REF);

    expect(report.repo.fullName).toEqual('a/b');
    expect(report.popularity).toEqual({ stars: 10, forks: 2, watchers: 3 });
    expect(report.activity?.commitsLast52Weeks).toEqual(3);
    expect(report.issues).toEqual({ openIssues: 0, openPulls: 0 });
    expect(report.releases).toBeNull();
    expect(report.traffic).toEqual({
      available: false,
      reason: 'requires push access',
    });
    expect(report.timeline.length).toBeGreaterThan(0);
    expect(report.errors).toEqual({});
  });

  it('propagates a failure of the core repo request', async () => {
    const client: HttpClient = {
      get: vi.fn(async (url: string) => {
        throw new HttpError(404, url, 'Not Found');
      }),
    };

    await expect(collectStats(client, REF)).rejects.toBeInstanceOf(HttpError);
  });

  it('keeps other sections when a single section fails', async () => {
    const client = fakeClient({
      '/releases?': () => {
        throw new Error('boom');
      },
    });

    const report = await collectStats(client, REF);
    expect(report.popularity).not.toBeNull();
    expect(report.releases).toBeNull();
    expect(report.errors.releases).toMatch(/boom/);
  });
});
