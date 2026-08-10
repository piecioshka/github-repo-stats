import { parseArgs } from 'node:util';

export class UsageError extends Error {}

export interface CliOptions {
  owner: string;
  repo: string;
  json: boolean;
  color: boolean;
}

const REPO_PATTERN = /^([\w.-]+)\/([\w.-]+)$/;

function parseRepoArgument(argument: string): { owner: string; repo: string } {
  let candidate = argument;

  if (candidate.includes('://') || candidate.startsWith('github.com/')) {
    const url = new URL(
      candidate.includes('://') ? candidate : `https://${candidate}`,
    );
    if (url.hostname !== 'github.com') {
      throw new UsageError(`Unsupported host: ${url.hostname}`);
    }
    candidate = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  candidate = candidate.replace(/\.git$/, '');

  const match = candidate.match(REPO_PATTERN);
  if (!match) {
    throw new UsageError(`Invalid repository: ${argument}`);
  }

  return { owner: match[1], repo: match[2] };
}

export function parseCliArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const [repoArgument] = parsed.positionals;
  if (!repoArgument) {
    throw new UsageError('Missing repository argument');
  }

  const { owner, repo } = parseRepoArgument(repoArgument);

  return {
    owner,
    repo,
    json: parsed.values.json === true,
    color: parsed.values['no-color'] !== true,
  };
}
