import { vi } from 'vitest';

import { RepoInfo } from '../api/github';
import { GetResult, HttpClient } from '../api/http';
import { Report } from '../collect';

type Route = () => { status?: number; body: unknown; headers?: Headers };

/**
 * HttpClient stub routing by URL fragment. A route may throw to simulate a
 * failed request; unmatched URLs go to `fallback` or fail the test.
 */
export function fakeClient(
  routes: Record<string, Route>,
  fallback?: (url: string) => GetResult,
): HttpClient {
  return {
    get: vi.fn(async (url: string) => {
      for (const [fragment, respond] of Object.entries(routes)) {
        if (url.includes(fragment)) {
          const { status = 200, body, headers = new Headers() } = respond();
          return { status, body, headers };
        }
      }
      if (fallback) {
        return fallback(url);
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    }),
  };
}

/** Raw /repos/:owner/:repo response matching `makeRepo()`. */
export const RAW_REPO_BODY = {
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

export function makeRepo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    fullName: 'a/b',
    description: 'Demo',
    htmlUrl: 'https://github.com/a/b',
    language: 'TypeScript',
    license: 'MIT License',
    createdAt: '2020-01-01T00:00:00Z',
    pushedAt: '2023-06-01T00:00:00Z',
    sizeKb: 128,
    isFork: false,
    isPrivate: true,
    isArchived: false,
    defaultBranch: 'main',
    topics: ['cli'],
    stars: 10,
    forks: 2,
    watchers: 3,
    openIssuesAndPulls: 3,
    ...overrides,
  };
}

export function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    repo: makeRepo(),
    popularity: { stars: 10, forks: 2, watchers: 3 },
    activity: {
      lastPushAt: '2023-06-01T00:00:00Z',
      commitsLast52Weeks: 3,
      contributors: { count: 7, capped: false },
    },
    issues: { openIssues: 1, openPulls: 2 },
    releases: null,
    timeline: [
      {
        label: 'Repository created',
        date: '2020-01-01T00:00:00Z',
        detail: null,
        gap: null,
      },
    ],
    traffic: { available: false, reason: 'requires push access' },
    errors: {},
    ...overrides,
  };
}
