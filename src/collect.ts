import {
  Contributors,
  getContributorsCount,
  getFirstCommit,
  getOpenCounts,
  getParticipationCommits,
  getReleases,
  getRepo,
  getTraffic,
  missingPermission,
  ReleasesSummary,
  RepoInfo,
  RepoRef,
  ReportSection,
  summarizeReleases,
  Traffic,
} from './api/github';
import { HttpClient } from './api/http';
import { errorMessage } from './errors';
import { buildTimeline, TimelineEvent } from './timeline';

export interface Report {
  repo: RepoInfo;
  popularity: { stars: number; forks: number; watchers: number };
  activity: {
    lastPushAt: string;
    commitsLast52Weeks: number | null;
    contributors: Contributors | null;
  };
  issues: { openIssues: number; openPulls: number } | null;
  releases: ReleasesSummary | null;
  timeline: TimelineEvent[];
  traffic: Traffic | null;
  /** Section → reason, for sections that failed to load. */
  errors: Partial<Record<ReportSection, string>>;
}

/**
 * Fetches all report sections concurrently. The core repository request is
 * fatal, every other section degrades to `null` with a note in `errors`.
 */
export async function collectStats(
  client: HttpClient,
  ref: RepoRef,
): Promise<Report> {
  const repoPromise = getRepo(client, ref);

  const [
    repoResult,
    openCounts,
    releases,
    firstCommit,
    participation,
    contributors,
    traffic,
  ] = await Promise.allSettled([
    repoPromise,
    repoPromise.then((repo) =>
      getOpenCounts(client, ref, repo.openIssuesAndPulls),
    ),
    getReleases(client, ref),
    getFirstCommit(client, ref),
    getParticipationCommits(client, ref),
    getContributorsCount(client, ref),
    getTraffic(client, ref),
  ]);

  if (repoResult.status === 'rejected') {
    throw repoResult.reason;
  }
  const repo = repoResult.value;

  const errors: Partial<Record<ReportSection, string>> = {};

  /** Unwraps a settled promise, recording the first failure per section. */
  const unwrap = <T>(
    result: PromiseSettledResult<T>,
    section: ReportSection,
  ): T | null => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    errors[section] ??=
      missingPermission(result.reason, section) ?? errorMessage(result.reason);
    return null;
  };

  const releaseList = unwrap(releases, 'releases');
  const releasesSummary = releaseList ? summarizeReleases(releaseList) : null;

  return {
    repo,
    popularity: {
      stars: repo.stars,
      forks: repo.forks,
      watchers: repo.watchers,
    },
    activity: {
      lastPushAt: repo.pushedAt,
      commitsLast52Weeks: unwrap(participation, 'activity'),
      contributors: unwrap(contributors, 'activity'),
    },
    issues: unwrap(openCounts, 'issues'),
    releases: releasesSummary,
    timeline: buildTimeline({
      createdAt: repo.createdAt,
      pushedAt: repo.pushedAt,
      firstCommit: unwrap(firstCommit, 'timeline'),
      releases: releasesSummary,
    }),
    traffic: unwrap(traffic, 'traffic'),
    errors,
  };
}
