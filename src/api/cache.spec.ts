import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readCache,
  resolveCacheDir,
  resolveCacheTtlHours,
  withCache,
  writeCache,
} from './cache';
import { GetResult, HttpClient } from './http';

const URL = 'https://api.github.com/repos/piecioshka/github-repo-stats';

function result(init: Partial<GetResult> = {}): GetResult {
  return {
    status: init.status ?? 200,
    body: init.body ?? { stargazers_count: 7 },
    headers: init.headers ?? new Headers({ etag: 'W/"abc"' }),
  };
}

/** Rewrites the stamp of the single entry in the directory, in hours back. */
function ageEntry(directory: string, hours: number): void {
  const [file] = readdirSync(directory);
  const target = join(directory, file);
  const entry = JSON.parse(readFileSync(target, 'utf8'));
  entry.savedAt = Date.now() - hours * 60 * 60 * 1000;
  writeFileSync(target, JSON.stringify(entry), 'utf8');
}

describe('cache', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'github-repo-stats-'));
    vi.stubEnv('CACHE_TTL_HOURS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('resolveCacheDir', () => {
    it('defaults to the user cache directory', () => {
      vi.stubEnv('XDG_CACHE_HOME', '');

      expect(resolveCacheDir()).toBe(
        join(homedir(), '.cache', 'github-repo-stats'),
      );
    });

    it('honours XDG_CACHE_HOME', () => {
      vi.stubEnv('XDG_CACHE_HOME', '/somewhere');

      expect(resolveCacheDir()).toBe(join('/somewhere', 'github-repo-stats'));
    });
  });

  describe('resolveCacheTtlHours', () => {
    it('defaults to 12 hours', () => {
      expect(resolveCacheTtlHours()).toBe(12);
    });

    it('honours CACHE_TTL_HOURS', () => {
      vi.stubEnv('CACHE_TTL_HOURS', '1');

      expect(resolveCacheTtlHours()).toBe(1);
    });

    it('falls back to the default rather than disabling the cache', () => {
      vi.stubEnv('CACHE_TTL_HOURS', 'soon');
      expect(resolveCacheTtlHours()).toBe(12);

      vi.stubEnv('CACHE_TTL_HOURS', '-1');
      expect(resolveCacheTtlHours()).toBe(12);
    });
  });

  describe('readCache and writeCache', () => {
    it('returns null when there is no entry', () => {
      expect(readCache(URL, directory)).toBeNull();
    });

    it('round-trips the status, the body and the headers', () => {
      writeCache(URL, result(), directory);

      const cached = readCache(URL, directory);

      expect(cached?.status).toBe(200);
      expect(cached?.body).toEqual({ stargazers_count: 7 });
      expect(cached?.headers.get('etag')).toBe('W/"abc"');
    });

    it('keeps entries separate per URL', () => {
      writeCache(URL, result({ body: { a: 1 } }), directory);
      writeCache(`${URL}/releases`, result({ body: { b: 2 } }), directory);

      expect(readCache(URL, directory)?.body).toEqual({ a: 1 });
      expect(readCache(`${URL}/releases`, directory)?.body).toEqual({ b: 2 });
    });

    it('does not cache a 202, which means "ask again later"', () => {
      writeCache(URL, result({ status: 202, body: null }), directory);

      expect(readdirSync(directory)).toHaveLength(0);
    });

    it('drops an entry older than the TTL', () => {
      writeCache(URL, result(), directory);
      ageEntry(directory, 13);

      expect(readCache(URL, directory)).toBeNull();
    });

    it('keeps an entry younger than the TTL', () => {
      writeCache(URL, result(), directory);
      ageEntry(directory, 11);

      expect(readCache(URL, directory)?.body).toEqual({ stargazers_count: 7 });
    });

    it('keeps entries forever when the TTL is 0', () => {
      vi.stubEnv('CACHE_TTL_HOURS', '0');
      writeCache(URL, result(), directory);
      ageEntry(directory, 24 * 365);

      expect(readCache(URL, directory)?.body).toEqual({ stargazers_count: 7 });
    });

    it('drops an entry with an unusable timestamp', () => {
      writeCache(URL, result(), directory);
      const [file] = readdirSync(directory);
      const entry = JSON.parse(readFileSync(join(directory, file), 'utf8'));
      delete entry.savedAt;
      writeFileSync(join(directory, file), JSON.stringify(entry), 'utf8');

      expect(readCache(URL, directory)).toBeNull();
    });

    it('treats a corrupted entry as a missing one', () => {
      writeCache(URL, result(), directory);
      const [file] = readdirSync(directory);
      writeFileSync(join(directory, file), '{ not json', 'utf8');

      expect(readCache(URL, directory)).toBeNull();
    });

    it('survives an unwritable cache directory', () => {
      expect(() =>
        writeCache(URL, result(), join('/dev/null', 'nope')),
      ).not.toThrow();
    });
  });

  describe('withCache', () => {
    function clientReturning(results: GetResult[]): HttpClient & {
      calls: string[];
    } {
      const calls: string[] = [];
      return {
        calls,
        get(url: string): Promise<GetResult> {
          calls.push(url);
          return Promise.resolve(results.shift() ?? result());
        },
      };
    }

    it('asks the client once and serves the rest from disk', async () => {
      const client = clientReturning([result({ body: { fresh: true } })]);
      const cached = withCache(client, { directory });

      expect((await cached.get(URL)).body).toEqual({ fresh: true });
      expect((await cached.get(URL)).body).toEqual({ fresh: true });
      expect(client.calls).toEqual([URL]);
    });

    it('bypasses the cache entirely when disabled', async () => {
      const client = clientReturning([]);
      const cached = withCache(client, { directory, enabled: false });

      await cached.get(URL);
      await cached.get(URL);

      expect(client.calls).toEqual([URL, URL]);
      expect(readdirSync(directory)).toHaveLength(0);
    });

    it('refetches once the entry has expired', async () => {
      const client = clientReturning([
        result({ body: { round: 1 } }),
        result({ body: { round: 2 } }),
      ]);
      const cached = withCache(client, { directory });

      expect((await cached.get(URL)).body).toEqual({ round: 1 });
      ageEntry(directory, 13);

      expect((await cached.get(URL)).body).toEqual({ round: 2 });
      expect(client.calls).toEqual([URL, URL]);
    });
  });
});
