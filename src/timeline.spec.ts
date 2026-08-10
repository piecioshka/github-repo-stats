import { describe, expect, it } from 'vitest';

import { buildTimeline, describeGap } from './timeline';

const BASE = {
  createdAt: '2020-01-01T12:00:00Z',
  pushedAt: '2023-06-01T00:00:00Z',
  firstCommit: {
    sha: 'abc1234def',
    author: 'Author',
    authoredAt: '2020-01-02T00:00:00Z',
  },
  releases: {
    count: 2,
    totalDownloads: 0,
    first: { tag: 'v1.0.0', createdAt: '2020-03-01T00:00:00Z' },
    latest: { tag: 'v2.0.0', createdAt: '2022-01-01T00:00:00Z' },
  },
};

describe('buildTimeline', () => {
  it('orders all events chronologically', () => {
    const events = buildTimeline(BASE);
    expect(events.map((event) => event.label)).toEqual([
      'Repository created',
      'First commit',
      'First release v1.0.0',
      'Latest release v2.0.0',
      'Last push',
    ]);
  });

  it('describes the gap since the previous event', () => {
    const events = buildTimeline(BASE);
    expect(events[0].gap).toBeNull();
    expect(events[1].gap).toEqual('1 day later');
    expect(events[2].gap).toEqual('59 days later');
  });

  it('skips releases when there are none', () => {
    const events = buildTimeline({ ...BASE, releases: null });
    expect(events.map((event) => event.label)).toEqual([
      'Repository created',
      'First commit',
      'Last push',
    ]);
  });

  it('skips the first commit when the repository is empty', () => {
    const events = buildTimeline({ ...BASE, firstCommit: null });
    expect(events.map((event) => event.label)).toEqual([
      'Repository created',
      'First release v1.0.0',
      'Latest release v2.0.0',
      'Last push',
    ]);
  });

  it('collapses first and latest release when there is only one', () => {
    const single = {
      count: 1,
      totalDownloads: 0,
      first: { tag: 'v1.0.0', createdAt: '2020-03-01T00:00:00Z' },
      latest: { tag: 'v1.0.0', createdAt: '2020-03-01T00:00:00Z' },
    };
    const events = buildTimeline({ ...BASE, releases: single });
    const releaseLabels = events
      .map((event) => event.label)
      .filter((label) => label.includes('release'));
    expect(releaseLabels).toEqual(['First release v1.0.0']);
  });

  it('mentions the commit author and short sha in the detail', () => {
    const events = buildTimeline(BASE);
    const firstCommit = events.find((event) => event.label === 'First commit');
    expect(firstCommit?.detail).toContain('abc1234');
    expect(firstCommit?.detail).toContain('Author');
  });
});

describe('describeGap', () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it('treats sub-day gaps as the same day', () => {
    expect(describeGap(5 * HOUR)).toEqual('later that day');
  });

  it('uses days below two months', () => {
    expect(describeGap(3 * DAY)).toEqual('3 days later');
    expect(describeGap(45 * DAY)).toEqual('45 days later');
  });

  it('uses months below two years', () => {
    expect(describeGap(90 * DAY)).toEqual('3 months later');
  });

  it('uses years above two years', () => {
    expect(describeGap(800 * DAY)).toEqual('2 years later');
  });

  it('uses the singular form for one unit', () => {
    expect(describeGap(DAY)).toEqual('1 day later');
  });
});
