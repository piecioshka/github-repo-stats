import {
  getContributorsCount,
  getFirstCommit,
  getOpenCounts,
  getParticipationCommits,
  getReleases,
  getRepo,
  getTraffic,
  ReleasesSummary,
  RepoInfo,
  RepoRef,
  summarizeReleases,
  Traffic,
} from './api/github';
import { HttpClient } from './api/http';
import { buildTimeline, TimelineEvent } from './timeline';

export interface Report {
  repo: RepoInfo;
  popularity: { stars: number; forks: number; watchers: number } | null;
  activity: {
    lastPushAt: string;
    commitsLast52Weeks: number | null;
    contributors: number | '5000+' | null;
  } | null;
  issues: { openIssues: number; openPulls: number } | null;
  releases: ReleasesSummary | null;
  timeline: TimelineEvent[];
  traffic: Traffic | null;
  /** Section name → reason, for sections that failed to load. */
  errors: Record<string, string>;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Unwraps a settled promise: returns its value, or records the failure under
 * the given section name (first failure wins) and returns null.
 */
function unwrap<T>(
  result: PromiseSettledResult<T>,
  section: string,
  errors: Record<string, string>,
): T | null {
  if (result.status === 'fulfilled') {
    return result.value;
  }
  if (!(section in errors)) {
    errors[section] = errorMessage(result.reason);
  }
  return null;
}

/**
 * Fetches all report sections concurrently. The core repository request is
 * fatal, every other section degrades to `null` with a note in `errors`.
 */
export async function collectStats(
  client: HttpClient,
  ref: RepoRef,
): Promise<Report> {
  const repo = await getRepo(client, ref);

  const settled = await Promise.allSettled([
    getOpenCounts(client, ref),
    getReleases(client, ref),
    getFirstCommit(client, ref),
    getParticipationCommits(client, ref),
    getContributorsCount(client, ref),
    getTraffic(client, ref),
  ]);
  const [
    openCounts,
    releases,
    firstCommit,
    participation,
    contributors,
    traffic,
  ] = settled;

  const errors: Record<string, string> = {};
  const releasesSummary = summarizeReleases(
    unwrap(releases, 'releases', errors) ?? [],
  );

  return {
    repo,
    popularity: {
      stars: repo.stars,
      forks: repo.forks,
      watchers: repo.watchers,
    },
    activity: {
      lastPushAt: repo.pushedAt,
      commitsLast52Weeks: unwrap(participation, 'activity', errors),
      contributors: unwrap(contributors, 'activity', errors),
    },
    issues: unwrap(openCounts, 'issues', errors),
    releases: releasesSummary,
    timeline: buildTimeline({
      createdAt: repo.createdAt,
      pushedAt: repo.pushedAt,
      firstCommit: unwrap(firstCommit, 'timeline', errors),
      releases: releasesSummary,
    }),
    traffic: unwrap(traffic, 'traffic', errors),
    errors,
  };
}
