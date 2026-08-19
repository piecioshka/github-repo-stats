import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { GetResult, HttpClient } from './http';

const CACHE_NAMESPACE = 'github-repo-stats';

// Repository statistics move slowly, but not so slowly that a report should
// show yesterday's numbers - half a day keeps reruns free without letting a
// report drift from reality.
const DEFAULT_TTL_HOURS = 12;

// GitHub answers 202 with an empty body while it computes an endpoint; the
// whole point is to ask again later, so such a response is not cacheable.
const PENDING_STATUS = 202;

interface CacheEntry {
  url: string;
  savedAt: number;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * The cache belongs to the user, not to the package - installed globally, the
 * package directory sits inside node_modules. Unlike a report, a cache has to
 * survive a reboot, so the system temp directory is the wrong home for it.
 */
export function resolveCacheDir(): string {
  const cacheHome =
    process.env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache');
  return join(cacheHome, CACHE_NAMESPACE);
}

/**
 * How long an entry stays valid, in hours. A malformed or negative value
 * would silently disable the cache, so it falls back to the default.
 */
export function resolveCacheTtlHours(): number {
  // An empty value is the state left by an unfilled .env entry - it means
  // "unset", not "0 hours", which would read as "keep forever".
  const raw = process.env.CACHE_TTL_HOURS?.trim();

  if (!raw) {
    return DEFAULT_TTL_HOURS;
  }

  const hours = Number(raw);
  return Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_TTL_HOURS;
}

function entryPath(url: string, directory: string): string {
  const hash = createHash('sha256').update(`GET:${url}`).digest('hex');
  return join(directory, `${hash.slice(0, 32)}.json`);
}

function isExpired(savedAt: unknown): boolean {
  const ttlHours = resolveCacheTtlHours();

  // A TTL of 0 means "keep forever".
  if (ttlHours === 0) {
    return false;
  }

  // An entry that cannot be aged is dropped rather than trusted forever.
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) {
    return true;
  }

  return Date.now() - savedAt > ttlHours * 60 * 60 * 1000;
}

/**
 * Rebuilds a response from a parsed entry, or returns null when the file held
 * something that is not one. A cache file is not trusted input: valid JSON
 * that is not an entry - "null", "42", an array - must not reach a field
 * access, which on null would throw and take the report down.
 */
function toGetResult(parsed: unknown): GetResult | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  if (!('status' in parsed) || typeof parsed.status !== 'number') {
    return null;
  }

  if (!('savedAt' in parsed) || isExpired(parsed.savedAt)) {
    return null;
  }

  return {
    status: parsed.status,
    body: 'body' in parsed ? parsed.body : null,
    headers: toHeaders(parsed),
  };
}

/** Header values that are not strings are dropped rather than coerced. */
function toHeaders(parsed: object): Headers {
  const headers = new Headers();

  if (
    !('headers' in parsed) ||
    parsed.headers === null ||
    typeof parsed.headers !== 'object'
  ) {
    return headers;
  }

  for (const [name, value] of Object.entries(parsed.headers)) {
    if (typeof value === 'string') {
      headers.append(name, value);
    }
  }

  return headers;
}

export function readCache(
  url: string,
  directory: string = resolveCacheDir(),
): GetResult | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(entryPath(url, directory), 'utf8'));
  } catch {
    // A missing or corrupted entry is treated as no entry at all.
    return null;
  }

  return toGetResult(parsed);
}

export function writeCache(
  url: string,
  result: GetResult,
  directory: string = resolveCacheDir(),
): void {
  if (result.status === PENDING_STATUS) {
    return;
  }

  const entry: CacheEntry = {
    url,
    savedAt: Date.now(),
    status: result.status,
    headers: Object.fromEntries(result.headers.entries()),
    body: result.body,
  };

  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(entryPath(url, directory), JSON.stringify(entry), 'utf8');
  } catch {
    // An unwritable cache directory must not take the report down with it.
  }
}

export interface CacheOptions {
  enabled?: boolean;
  directory?: string;
}

/**
 * Wraps a client so that successful responses are served from disk. Keeping
 * this out of `createHttpClient` leaves the retry and rate-limit policy in
 * one place and the storage policy in another.
 */
export function withCache(
  client: HttpClient,
  options: CacheOptions = {},
): HttpClient {
  if (options.enabled === false) {
    return client;
  }

  const directory = options.directory ?? resolveCacheDir();

  return {
    async get(url: string): Promise<GetResult> {
      const cached = readCache(url, directory);
      if (cached) {
        return cached;
      }

      const result = await client.get(url);
      writeCache(url, result, directory);
      return result;
    },
  };
}
