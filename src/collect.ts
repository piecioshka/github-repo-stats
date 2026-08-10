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
import { HttpClient, HttpError } from './api/http';
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

/**
 * Fine-grained token permission each section needs (documented in README).
 * Traffic is absent on purpose — getTraffic maps its own 403.
 */
const FINE_GRAINED_PERMISSIONS: Record<string, string> = {
  issues: 'Pull requests: Read-only',
  releases: 'Contents: Read-only',
  timeline: 'Contents: Read-only',
  activity: 'Contents: Read-only',
};

function errorMessage(reason: unknown, section: string): string {
  if (
    reason instanceof HttpError &&
    reason.status === 403 &&
    /not accessible by personal access token/i.test(reason.bodyText) &&
    section in FINE_GRAINED_PERMISSIONS
  ) {
    return `fine-grained token lacks the "${FINE_GRAINED_PERMISSIONS[section]}" permission`;
  }
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
    errors[section] = errorMessage(result.reason, section);
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
    getOpenCounts(client, ref, repo.openIssuesAndPulls),
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
