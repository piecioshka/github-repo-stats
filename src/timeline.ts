import { FirstCommit, ReleasesSummary } from './api/github';

export interface TimelineEvent {
  label: string;
  date: string;
  detail: string | null;
  /** Human description of the distance to the previous event. */
  gap: string | null;
}

export interface TimelineInput {
  createdAt: string;
  pushedAt: string;
  firstCommit: FirstCommit | null;
  releases: ReleasesSummary | null;
}

const DAY_MS = 86_400_000;
const SHORT_SHA_LENGTH = 7;
const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365.25;

function plural(amount: number, unit: string): string {
  return `${amount} ${unit}${amount === 1 ? '' : 's'} later`;
}

export function describeGap(ms: number): string {
  const days = Math.round(ms / DAY_MS);
  if (days < 1) {
    return 'later that day';
  }
  if (days < 60) {
    return plural(days, 'day');
  }
  if (days < 2 * DAYS_PER_YEAR) {
    return plural(Math.round(days / DAYS_PER_MONTH), 'month');
  }
  return plural(Math.round(days / DAYS_PER_YEAR), 'year');
}

export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const events: Array<Omit<TimelineEvent, 'gap'>> = [
    { label: 'Repository created', date: input.createdAt, detail: null },
  ];

  if (input.firstCommit?.authoredAt) {
    const { sha, author, authoredAt } = input.firstCommit;
    const shortSha = sha.slice(0, SHORT_SHA_LENGTH);
    events.push({
      label: 'First commit',
      date: authoredAt,
      detail: author ? `${shortSha} by ${author}` : shortSha,
    });
  }

  if (input.releases) {
    const { first, latest } = input.releases;
    events.push({
      label: `First release ${first.tag}`,
      date: first.createdAt,
      detail: null,
    });
    if (input.releases.count > 1) {
      events.push({
        label: `Latest release ${latest.tag}`,
        date: latest.createdAt,
        detail: null,
      });
    }
  }

  events.push({ label: 'Last push', date: input.pushedAt, detail: null });

  // Parse each date once; sort and gaps reuse the same timestamp.
  const timed = events
    .map((event) => ({ event, time: Date.parse(event.date) }))
    .sort((left, right) => left.time - right.time);

  return timed.map(({ event, time }, index) => ({
    ...event,
    gap: index === 0 ? null : describeGap(time - timed[index - 1].time),
  }));
}
