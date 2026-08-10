import { HttpClient, HttpError, sleep } from './http';

const DEFAULT_API_URL = 'https://api.github.com';

/**
 * Base URL of the GitHub REST API. Overridable with the GITHUB_API_URL
 * environment variable for GitHub Enterprise, e.g.
 * `https://github.mycompany.com/api/v3`.
 */
function apiUrl(): string {
  const override = process.env.GITHUB_API_URL;
  return override ? override.replace(/\/+$/, '') : DEFAULT_API_URL;
}

const RELEASES_PAGE_SIZE = 100;
const PARTICIPATION_MAX_ATTEMPTS = 3;
const PARTICIPATION_RETRY_MS = 2000;
const CONTRIBUTORS_CAP = 5000;

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoInfo {
  fullName: string;
  description: string | null;
  htmlUrl: string;
  language: string | null;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  sizeKb: number;
  isFork: boolean;
  isPrivate: boolean;
  isArchived: boolean;
  defaultBranch: string;
  topics: string[];
  stars: number;
  forks: number;
  watchers: number;
  openIssuesAndPulls: number;
}

export interface FirstCommit {
  sha: string;
  author: string | null;
  authoredAt: string | null;
}

export interface Release {
  tag_name: string;
  created_at: string;
  assets: Array<{ download_count: number }>;
}

export interface ReleasesSummary {
  count: number;
  totalDownloads: number;
  first: { tag: string; createdAt: string };
  latest: { tag: string; createdAt: string };
}

export interface Contributors {
  count: number;
  /** True when GitHub refuses to list a huge repository (5000+ authors). */
  capped: boolean;
}

export interface TrafficEntry {
  count: number;
  uniques: number;
}

export interface Referrer {
  referrer: string;
  count: number;
  uniques: number;
}

export interface PopularPath {
  path: string;
  title: string;
  count: number;
  uniques: number;
}

export type Traffic =
  | { available: false; reason: string }
  | {
      available: true;
      views: TrafficEntry;
      clones: TrafficEntry;
      referrers: Referrer[];
      paths: PopularPath[];
    };

export type ReportSection =
  'issues' | 'releases' | 'timeline' | 'activity' | 'traffic';

/**
 * Fine-grained token permission each report section needs (documented in
 * the README under "Required token permissions").
 */
const FINE_GRAINED_PERMISSIONS: Record<ReportSection, string> = {
  issues: 'Pull requests: Read-only',
  releases: 'Contents: Read-only',
  timeline: 'Contents: Read-only',
  activity: 'Contents: Read-only',
  traffic: 'Administration: Read-only',
};

/**
 * Maps a 403 caused by a fine-grained token without the section's permission
 * to a human-readable reason; null for every other error.
 */
export function missingPermission(
  error: unknown,
  section: ReportSection,
): string | null {
  if (
    error instanceof HttpError &&
    error.status === 403 &&
    /not accessible by personal access token/i.test(error.bodyText)
  ) {
    return `fine-grained token lacks the "${FINE_GRAINED_PERMISSIONS[section]}" permission`;
  }
  return null;
}

function repoUrl(ref: RepoRef, path = ''): string {
  return `${apiUrl()}/repos/${ref.owner}/${ref.repo}${path}`;
}

function lastPageFromLink(headers: Headers): number | null {
  const link = headers.get('link');
  if (!link) {
    return null;
  }
  const match = link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

/**
 * Total number of items in a paginated collection queried with `per_page=1`.
 * GitHub omits the `Link` header entirely when everything fits on one page,
 * so with 0 or 1 items the body length is the answer.
 */
export function countFromCollection(headers: Headers, body: unknown[]): number {
  return lastPageFromLink(headers) ?? body.length;
}

interface RawRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  license: { name?: string } | null;
  created_at: string;
  pushed_at: string;
  size: number;
  fork: boolean;
  private: boolean;
  archived: boolean;
  default_branch: string;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  open_issues_count: number;
}

export async function getRepo(
  client: HttpClient,
  ref: RepoRef,
): Promise<RepoInfo> {
  const { body } = await client.get(repoUrl(ref));
  const raw = body as RawRepo;
  return {
    fullName: raw.full_name,
    description: raw.description,
    htmlUrl: raw.html_url,
    language: raw.language,
    license: raw.license ? (raw.license.name ?? null) : null,
    createdAt: raw.created_at,
    pushedAt: raw.pushed_at,
    sizeKb: raw.size,
    isFork: raw.fork,
    isPrivate: raw.private,
    isArchived: raw.archived,
    defaultBranch: raw.default_branch,
    topics: raw.topics ?? [],
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    watchers: raw.subscribers_count,
    openIssuesAndPulls: raw.open_issues_count,
  };
}

/**
 * The /issues endpoint uses cursor pagination (no rel="last"), so the issue
 * count comes from the repository's `open_issues_count` (which includes pull
 * requests) minus the open PR count read from the /pulls Link header.
 */
export async function getOpenCounts(
  client: HttpClient,
  ref: RepoRef,
  openIssuesAndPulls: number,
): Promise<{ openIssues: number; openPulls: number }> {
  const pulls = await client.get(repoUrl(ref, '/pulls?state=open&per_page=1'));
  const openPulls = countFromCollection(pulls.headers, pulls.body as unknown[]);
  return { openIssues: Math.max(0, openIssuesAndPulls - openPulls), openPulls };
}

function releasesUrl(ref: RepoRef, page: number): string {
  return repoUrl(ref, `/releases?per_page=${RELEASES_PAGE_SIZE}&page=${page}`);
}

/**
 * Fetches the first page, then the remaining pages concurrently — the page
 * count is known upfront from the `Link` header.
 */
export async function getReleases(
  client: HttpClient,
  ref: RepoRef,
): Promise<Release[]> {
  const first = await client.get(releasesUrl(ref, 1));
  const releases = first.body as Release[];

  const lastPage = lastPageFromLink(first.headers);
  if (lastPage === null || lastPage === 1) {
    return releases;
  }

  const pages: number[] = [];
  for (let page = 2; page <= lastPage; page++) {
    pages.push(page);
  }
  const rest = await Promise.all(
    pages.map(async (page) => {
      const { body } = await client.get(releasesUrl(ref, page));
      return body as Release[];
    }),
  );

  return releases.concat(...rest);
}

/**
 * First and latest release are picked by `created_at` — the API sort order
 * is not part of the contract.
 */
export function summarizeReleases(releases: Release[]): ReleasesSummary | null {
  if (releases.length === 0) {
    return null;
  }

  let first = releases[0];
  let latest = releases[0];
  let totalDownloads = 0;

  for (const release of releases) {
    if (release.created_at < first.created_at) {
      first = release;
    }
    if (release.created_at > latest.created_at) {
      latest = release;
    }
    for (const asset of release.assets) {
      totalDownloads += asset.download_count;
    }
  }

  return {
    count: releases.length,
    totalDownloads,
    first: { tag: first.tag_name, createdAt: first.created_at },
    latest: { tag: latest.tag_name, createdAt: latest.created_at },
  };
}

interface CommitEntry {
  sha: string;
  commit: { author: { name?: string; date?: string } | null };
}

export async function getFirstCommit(
  client: HttpClient,
  ref: RepoRef,
): Promise<FirstCommit | null> {
  let response;
  try {
    response = await client.get(repoUrl(ref, '/commits?per_page=1'));
  } catch (error) {
    // 409 = "Git Repository is empty".
    if (error instanceof HttpError && error.status === 409) {
      return null;
    }
    throw error;
  }

  const lastPage = lastPageFromLink(response.headers);
  if (lastPage !== null) {
    response = await client.get(
      repoUrl(ref, `/commits?per_page=1&page=${lastPage}`),
    );
  }

  const commits = response.body as CommitEntry[];
  const oldest = commits[commits.length - 1];
  if (!oldest) {
    return null;
  }

  return {
    sha: oldest.sha,
    author: oldest.commit.author?.name ?? null,
    authoredAt: oldest.commit.author?.date ?? null,
  };
}

/**
 * Sum of commits from the last 52 weeks. GitHub computes these stats lazily
 * and responds 202 until they are ready — retry a few times, then give up
 * gracefully.
 */
export async function getParticipationCommits(
  client: HttpClient,
  ref: RepoRef,
): Promise<number | null> {
  for (let attempt = 1; attempt <= PARTICIPATION_MAX_ATTEMPTS; attempt++) {
    const { status, body } = await client.get(
      repoUrl(ref, '/stats/participation'),
    );
    if (status !== 202) {
      const participation = body as { all: number[] };
      return participation.all.reduce((sum, weekly) => sum + weekly, 0);
    }
    if (attempt < PARTICIPATION_MAX_ATTEMPTS) {
      await sleep(PARTICIPATION_RETRY_MS);
    }
  }
  return null;
}

export async function getContributorsCount(
  client: HttpClient,
  ref: RepoRef,
): Promise<Contributors> {
  try {
    const { headers, body } = await client.get(
      repoUrl(ref, '/contributors?per_page=1&anon=true'),
    );
    return {
      count: countFromCollection(headers, body as unknown[]),
      capped: false,
    };
  } catch (error) {
    // GitHub refuses to list contributors for huge repositories.
    if (
      error instanceof HttpError &&
      error.status === 403 &&
      /too large/i.test(error.bodyText)
    ) {
      return { count: CONTRIBUTORS_CAP, capped: true };
    }
    throw error;
  }
}

export async function getTraffic(
  client: HttpClient,
  ref: RepoRef,
): Promise<Traffic> {
  try {
    const [views, clones, referrers, paths] = await Promise.all([
      client.get(repoUrl(ref, '/traffic/views')),
      client.get(repoUrl(ref, '/traffic/clones')),
      client.get(repoUrl(ref, '/traffic/popular/referrers')),
      client.get(repoUrl(ref, '/traffic/popular/paths')),
    ]);

    // count/uniques are picked explicitly to drop the daily breakdown
    // arrays the API sends alongside them.
    const viewsBody = views.body as TrafficEntry;
    const clonesBody = clones.body as TrafficEntry;
    return {
      available: true,
      views: { count: viewsBody.count, uniques: viewsBody.uniques },
      clones: { count: clonesBody.count, uniques: clonesBody.uniques },
      referrers: referrers.body as Referrer[],
      paths: paths.body as PopularPath[],
    };
  } catch (error) {
    // Traffic requires authentication (401 without a token) and push access
    // (403 with a foreign token) — both mean "not yours", not "request
    // failed". Rate-limit 403s never reach this point: the HTTP client turns
    // them into RateLimitError.
    if (!(error instanceof HttpError)) {
      throw error;
    }
    if (error.status === 401) {
      return { available: false, reason: 'requires authentication' };
    }
    if (error.status === 403) {
      return {
        available: false,
        reason: missingPermission(error, 'traffic') ?? 'requires push access',
      };
    }
    throw error;
  }
}
