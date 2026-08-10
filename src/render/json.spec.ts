import { describe, expect, it } from 'vitest';

import { Report } from '../collect';
import { buildJsonPayload } from './json';

const REPORT: Report = {
  repo: {
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
  },
  popularity: { stars: 10, forks: 2, watchers: 3 },
  activity: {
    lastPushAt: '2023-06-01T00:00:00Z',
    commitsLast52Weeks: 3,
    contributors: 7,
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
  errors: { releases: 'boom' },
};

describe('buildJsonPayload', () => {
  it('exposes a stable top-level shape', () => {
    const payload = buildJsonPayload(REPORT);
    expect(Object.keys(payload)).toEqual([
      'repository',
      'popularity',
      'activity',
      'issues',
      'releases',
      'timeline',
      'traffic',
      'errors',
    ]);
  });

  it('keeps failed sections as null', () => {
    const payload = buildJsonPayload(REPORT);
    expect(payload.releases).toBeNull();
    expect(payload.errors).toEqual({ releases: 'boom' });
  });

  it('serializes to valid JSON', () => {
    const text = JSON.stringify(buildJsonPayload(REPORT));
    expect(JSON.parse(text).repository.fullName).toEqual('a/b');
  });
});
