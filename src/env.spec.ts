import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDotEnv } from './env';

const TMP_DIR = join(__dirname, '..', 'tmp', 'env-spec');
const ENV_FILE = join(TMP_DIR, '.env');

describe('loadDotEnv', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.GITHUB_REPO_STATS_SPEC_TOKEN;
  });

  it('loads variables from the file into process.env', () => {
    writeFileSync(ENV_FILE, 'GITHUB_REPO_STATS_SPEC_TOKEN=from-file\n');

    loadDotEnv(ENV_FILE);

    expect(process.env.GITHUB_REPO_STATS_SPEC_TOKEN).toEqual('from-file');
  });

  it('never overrides variables already present in the environment', () => {
    process.env.GITHUB_REPO_STATS_SPEC_TOKEN = 'from-shell';
    writeFileSync(ENV_FILE, 'GITHUB_REPO_STATS_SPEC_TOKEN=from-file\n');

    loadDotEnv(ENV_FILE);

    expect(process.env.GITHUB_REPO_STATS_SPEC_TOKEN).toEqual('from-shell');
  });

  it('silently ignores a missing file', () => {
    expect(() => loadDotEnv(join(TMP_DIR, 'nope.env'))).not.toThrow();
  });
});
