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
 * Fetches all report sections concurrently. The core repository request is
 * fatal, every other section degrades to `null` with a note in `errors`.
 */
export async function collectStats(
  client: HttpClient,
  ref: RepoRef,
): Promise<Report> {
  const repo = await getRepo(client, ref);

  const [openCounts, releases, firstCommit, participation, contributors, traffic] =
    await Promise.allSettled([
      getOpenCounts(client, ref),
      getReleases(client, ref),
      getFirstCommit(client, ref),
      getParticipationCommits(client, ref),
      getContributorsCount(client, ref),
      getTraffic(client, ref),
    ]);

  const errors: Record<string, string> = {};

  if (openCounts.status === 'rejected') {
    errors.issues = errorMessage(openCounts.reason);
  }
  if (releases.status === 'rejected') {
    errors.releases = errorMessage(releases.reason);
  }
  if (firstCommit.status === 'rejected') {
    errors.timeline = errorMessage(firstCommit.reason);
  }
  if (participation.status === 'rejected' || contributors.status === 'rejected') {
    errors.activity = errorMessage(
      participation.status === 'rejected'
        ? participation.reason
        : contributors.status === 'rejected'
          ? contributors.reason
          : '',
    );
  }
  if (traffic.status === 'rejected') {
    errors.traffic = errorMessage(traffic.reason);
  }

  const releasesSummary =
    releases.status === 'fulfilled' ? summarizeReleases(releases.value) : null;

  return {
    repo,
    popularity: {
      stars: repo.stars,
      forks: repo.forks,
      watchers: repo.watchers,
    },
    activity: {
      lastPushAt: repo.pushedAt,
      commitsLast52Weeks:
        participation.status === 'fulfilled' ? participation.value : null,
      contributors:
        contributors.status === 'fulfilled' ? contributors.value : null,
    },
    issues: openCounts.status === 'fulfilled' ? openCounts.value : null,
    releases: releasesSummary,
    timeline: buildTimeline({
      createdAt: repo.createdAt,
      pushedAt: repo.pushedAt,
      firstCommit: firstCommit.status === 'fulfilled' ? firstCommit.value : null,
      releases: releasesSummary,
    }),
    traffic: traffic.status === 'fulfilled' ? traffic.value : null,
    errors,
  };
}
