import { HttpClient, HttpError } from './http';

const API = 'https://api.github.com';

const RELEASES_PAGE_SIZE = 100;
const PARTICIPATION_MAX_ATTEMPTS = 3;
const PARTICIPATION_RETRY_MS = 2000;

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
  isArchived: boolean;
  defaultBranch: string;
  topics: string[];
  stars: number;
  forks: number;
  watchers: number;
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

export interface TrafficEntry {
  count: number;
  uniques: number;
}

export type Traffic =
  | { available: false; reason: string }
  | {
      available: true;
      views: TrafficEntry;
      clones: TrafficEntry;
      referrers: Array<{ referrer: string; count: number; uniques: number }>;
      paths: Array<{
        path: string;
        title: string;
        count: number;
        uniques: number;
      }>;
    };

function repoUrl(ref: RepoRef, path = ''): string {
  return `${API}/repos/${ref.owner}/${ref.repo}${path}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  archived: boolean;
  default_branch: string;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
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
    isArchived: raw.archived,
    defaultBranch: raw.default_branch,
    topics: raw.topics ?? [],
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    watchers: raw.subscribers_count,
  };
}

export async function getOpenCounts(
  client: HttpClient,
  ref: RepoRef,
): Promise<{ openIssues: number; openPulls: number }> {
  const [issues, pulls] = await Promise.all([
    client.get(repoUrl(ref, '/issues?state=open&per_page=1')),
    client.get(repoUrl(ref, '/pulls?state=open&per_page=1')),
  ]);

  const issuesAndPulls = countFromCollection(
    issues.headers,
    issues.body as unknown[],
  );
  const openPulls = countFromCollection(pulls.headers, pulls.body as unknown[]);

  // The /issues endpoint counts pull requests too — subtract them.
  return { openIssues: issuesAndPulls - openPulls, openPulls };
}

export async function getReleases(
  client: HttpClient,
  ref: RepoRef,
): Promise<Release[]> {
  const releases: Release[] = [];
  for (let page = 1; ; page++) {
    const { body } = await client.get(
      repoUrl(ref, `/releases?per_page=${RELEASES_PAGE_SIZE}&page=${page}`),
    );
    const items = body as Release[];
    releases.push(...items);
    if (items.length < RELEASES_PAGE_SIZE) {
      return releases;
    }
  }
}

/**
 * First and latest release are picked by `created_at` — the API sort order
 * is not part of the contract.
 */
export function summarizeReleases(
  releases: Release[],
): ReleasesSummary | null {
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
): Promise<number | '5000+'> {
  try {
    const { headers, body } = await client.get(
      repoUrl(ref, '/contributors?per_page=1&anon=true'),
    );
    return countFromCollection(headers, body as unknown[]);
  } catch (error) {
    // GitHub refuses to list contributors for huge repositories.
    if (
      error instanceof HttpError &&
      error.status === 403 &&
      /too large/i.test(error.bodyText)
    ) {
      return '5000+';
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

    const viewsBody = views.body as TrafficEntry;
    const clonesBody = clones.body as TrafficEntry;
    return {
      available: true,
      views: { count: viewsBody.count, uniques: viewsBody.uniques },
      clones: { count: clonesBody.count, uniques: clonesBody.uniques },
      referrers: referrers.body as Array<{
        referrer: string;
        count: number;
        uniques: number;
      }>,
      paths: paths.body as Array<{
        path: string;
        title: string;
        count: number;
        uniques: number;
      }>,
    };
  } catch (error) {
    // Traffic requires push access — a 403 here means "not yours", not
    // "request failed". Rate-limit 403s never reach this point: the HTTP
    // client turns them into RateLimitError.
    if (error instanceof HttpError && error.status === 403) {
      return { available: false, reason: 'requires push access' };
    }
    throw error;
  }
}
