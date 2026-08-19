import { withCache } from './api/cache';
import { createHttpClient, HttpError, RateLimitError } from './api/http';
import { collectStats } from './collect';
import { loadDotEnv } from './env';
import { errorMessage } from './errors';
import { CliOptions, parseCliArgs, UsageError } from './parse-args';
import { renderReport } from './render/console';
import { buildJsonPayload } from './render/json';

const USAGE = `Usage: github-repo-stats <owner>/<repo> [--json] [--no-color] [--no-cache]

Reads the optional GITHUB_TOKEN environment variable to raise rate limits
and unlock the traffic section (requires push access to the repository).

API responses are cached in $XDG_CACHE_HOME/github-repo-stats (falling back
to ~/.cache/github-repo-stats) for 12 hours; set CACHE_TTL_HOURS to change
that window (0 keeps entries forever) or pass --no-cache to skip the cache
for a single run.`;

function describeFailure(error: unknown, options: CliOptions): string {
  if (error instanceof HttpError && error.status === 404) {
    return `Repository ${options.owner}/${options.repo} does not exist or is private (set GITHUB_TOKEN).`;
  }
  if (error instanceof RateLimitError) {
    return error.message;
  }
  return errorMessage(error);
}

async function printReport(options: CliOptions): Promise<void> {
  const client = withCache(
    createHttpClient({ token: process.env.GITHUB_TOKEN }),
    { enabled: options.cache },
  );
  const ref = { owner: options.owner, repo: options.repo };
  const report = await collectStats(client, ref);
  const output = options.json
    ? JSON.stringify(buildJsonPayload(report), null, 2)
    : renderReport(report, { color: options.color });
  console.log(output);
}

export async function run(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      return 1;
    }
    throw error;
  }

  // The .env file may hold GITHUB_TOKEN and GITHUB_API_URL; skip reading it
  // entirely when the arguments are invalid anyway.
  loadDotEnv();

  try {
    await printReport(options);
    return 0;
  } catch (error) {
    console.error(describeFailure(error, options));
    return 1;
  }
}
