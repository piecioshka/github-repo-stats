import { createHttpClient, HttpError, RateLimitError } from './api/http';
import { collectStats } from './collect';
import { loadDotEnv } from './env';
import { CliOptions, parseCliArgs, UsageError } from './parse-args';
import { renderReport } from './render/console';
import { buildJsonPayload } from './render/json';

const USAGE = `Usage: github-repo-stats <owner>/<repo> [--json] [--no-color]

Reads the optional GITHUB_TOKEN environment variable to raise rate limits
and unlock the traffic section (requires push access to the repository).`;

function printUsage(error: UsageError): void {
  console.error(error.message);
  console.error('');
  console.error(USAGE);
}

function describeFailure(error: unknown, options: CliOptions): string {
  if (error instanceof HttpError && error.status === 404) {
    return `Repository ${options.owner}/${options.repo} does not exist or is private (set GITHUB_TOKEN).`;
  }
  if (error instanceof RateLimitError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function printReport(options: CliOptions): Promise<void> {
  const client = createHttpClient({ token: process.env.GITHUB_TOKEN });
  const ref = { owner: options.owner, repo: options.repo };
  const report = await collectStats(client, ref);
  const output = options.json
    ? JSON.stringify(buildJsonPayload(report), null, 2)
    : renderReport(report, { color: options.color });
  console.log(output);
}

export async function run(argv: string[]): Promise<number> {
  loadDotEnv();

  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      printUsage(error);
      return 1;
    }
    throw error;
  }

  try {
    await printReport(options);
    return 0;
  } catch (error) {
    console.error(describeFailure(error, options));
    return 1;
  }
}
