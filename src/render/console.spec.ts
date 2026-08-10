import { describe, expect, it } from 'vitest';

import { Report } from '../collect';
import { renderReport } from './console';

const REPORT: Report = {
  repo: {
    fullName: 'a/b',
    description: 'Demo project',
    htmlUrl: 'https://github.com/a/b',
    language: 'TypeScript',
    license: 'MIT License',
    createdAt: '2020-01-01T00:00:00Z',
    pushedAt: '2023-06-01T00:00:00Z',
    sizeKb: 128,
    isFork: false,
    isPrivate: true,
    isArchived: true,
    defaultBranch: 'main',
    topics: ['cli', 'stats'],
    stars: 10,
    forks: 2,
    watchers: 3,
    openIssuesAndPulls: 3,
  },
  popularity: { stars: 10, forks: 2, watchers: 3 },
  activity: {
    lastPushAt: '2023-06-01T00:00:00Z',
    commitsLast52Weeks: 3,
    contributors: '5000+',
  },
  issues: { openIssues: 1, openPulls: 2 },
  releases: {
    count: 4,
    totalDownloads: 16,
    first: { tag: 'v1.0.0', createdAt: '2020-03-01T00:00:00Z' },
    latest: { tag: 'v2.0.0', createdAt: '2022-01-01T00:00:00Z' },
  },
  timeline: [
    {
      label: 'Repository created',
      date: '2020-01-01T00:00:00Z',
      detail: null,
      gap: null,
    },
    {
      label: 'First commit',
      date: '2020-01-02T00:00:00Z',
      detail: 'abc1234 by Author',
      gap: '1 day later',
    },
  ],
  traffic: { available: false, reason: 'requires push access' },
  errors: { issues: 'boom' },
};

describe('renderReport', () => {
  const output = renderReport(REPORT, { color: false });

  it('renders every section header', () => {
    for (const header of [
      'Overview',
      'Popularity',
      'Activity',
      'Issues / Pull requests',
      'Releases',
      'Timeline',
      'Traffic',
    ]) {
      expect(output).toContain(header);
    }
  });

  it('renders key values', () => {
    expect(output).toContain('a/b');
    expect(output).toContain('10');
    expect(output).toContain('v2.0.0');
    expect(output).toContain('5000+');
    expect(output).toContain('archived');
  });

  it('shows private visibility in the Overview section', () => {
    expect(output).toContain('Visibility');
    expect(output).toContain('🔐 private');
    expect(output).not.toContain('[private]');
  });

  it('shows public visibility in the Overview section', () => {
    const publicOutput = renderReport(
      { ...REPORT, repo: { ...REPORT.repo, isPrivate: false } },
      { color: false },
    );
    expect(publicOutput).toContain('public');
    expect(publicOutput).not.toContain('🔐');
  });

  it('renders the timeline with gaps and details', () => {
    expect(output).toContain('First commit');
    expect(output).toContain('1 day later');
    expect(output).toContain('abc1234 by Author');
  });

  it('explains why traffic is unavailable', () => {
    expect(output).toContain('requires push access');
  });

  it('annotates failed sections', () => {
    expect(output).toContain('boom');
  });

  it('contains no ANSI escapes when colors are disabled', () => {
    expect(output).not.toContain('[');
  });
});
