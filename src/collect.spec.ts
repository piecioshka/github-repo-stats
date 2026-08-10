import { describe, expect, it, vi } from 'vitest';

import { HttpClient, HttpError } from './api/http';
import { collectStats } from './collect';
import { fakeClient, RAW_REPO_BODY } from './testing/fixtures';

function apiClient(overrides: Record<string, () => { body: unknown }> = {}) {
  return fakeClient(overrides, (url) => {
    if (url.includes('/traffic/')) {
      throw new HttpError(403, url, 'Must have push access');
    }
    if (url.includes('/stats/participation')) {
      return { status: 200, body: { all: [1, 2] }, headers: new Headers() };
    }
    if (url.endsWith('/repos/a/b')) {
      return { status: 200, body: RAW_REPO_BODY, headers: new Headers() };
    }
    // Collections: pulls, releases, commits, contributors.
    return { status: 200, body: [], headers: new Headers() };
  });
}

const REF = { owner: 'a', repo: 'b' };

describe('collectStats', () => {
  it('assembles a full report', async () => {
    const report = await collectStats(apiClient(), REF);

    expect(report.repo.fullName).toEqual('a/b');
    expect(report.popularity).toEqual({ stars: 10, forks: 2, watchers: 3 });
    expect(report.activity.commitsLast52Weeks).toEqual(3);
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
    const client = apiClient({
      '/releases?': () => {
        throw new Error('boom');
      },
    });

    const report = await collectStats(client, REF);
    expect(report.popularity).not.toBeNull();
    expect(report.releases).toBeNull();
    expect(report.errors.releases).toMatch(/boom/);
  });

  it('points at the missing fine-grained permission when a section gets 403', async () => {
    const client = apiClient({
      '/pulls?': () => {
        throw new HttpError(
          403,
          'https://api.github.com/repos/a/b/pulls',
          '{"message":"Resource not accessible by personal access token"}',
        );
      },
    });

    const report = await collectStats(client, REF);
    expect(report.issues).toBeNull();
    expect(report.errors.issues).toContain('Pull requests: Read-only');
  });
});
