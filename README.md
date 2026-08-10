# github-repo-stats 🔎

[![github-ci](https://github.com/piecioshka/github-repo-stats/actions/workflows/testing.yml/badge.svg)](https://github.com/piecioshka/github-repo-stats/actions/workflows/testing.yml) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://piecioshka.mit-license.org)

🔎 CLI to inspect GitHub repository statistics: popularity, activity, issues, releases, timeline, and traffic.

> Give a ⭐️ if this project helped you!

## Features

- ✅ Overview: language, license, size, topics, archived/fork flags
- ✅ Popularity: stars, forks, watchers
- ✅ Activity: last push, commits from the last 52 weeks, contributors
- ✅ Issues / PRs: open issues (without PRs) and open pull requests
- ✅ Releases: count, latest tag, total asset downloads
- ✅ Timeline: repository created → first commit → first release → latest release → last push, with human-readable gaps
- ✅ Traffic (with `GITHUB_TOKEN` and push access): views, clones, top referrers, top paths
- ✅ `--json` output for scripting
- ✅ Zero runtime dependencies

## Usage

```bash
npm install
npm run build
node bin/cli.js <owner>/<repo>
```

Examples:

```bash
node bin/cli.js piecioshka/super-event-emitter
node bin/cli.js https://github.com/nodejs/node
node bin/cli.js piecioshka/super-event-emitter --json
node bin/cli.js piecioshka/super-event-emitter --no-color
```

## Authentication (optional)

Without a token the tool uses the anonymous GitHub API limit (60 requests/hour). Set the `GITHUB_TOKEN` environment variable to raise the limit and unlock the traffic section:

```bash
GITHUB_TOKEN=ghp_xxx node bin/cli.js <owner>/<repo>
```

> [!NOTE]
>
> The traffic section requires push access to the repository — GitHub exposes views and clones only to maintainers, and only for the last 14 days.

> [!TIP]
>
> The token is read exclusively from the environment. There is no `--token` flag on purpose: command-line arguments end up in the shell history.

## How it works

- The open PR count is read from the `Link` pagination header of `/pulls?per_page=1` — no Search API, no listing thousands of items. The open issue count is the repository's `open_issues_count` (which includes pull requests) minus that PR count.
- The first commit is found with two requests: the `Link` header points at the last page of `/commits?per_page=1`, which holds the oldest commit.
- The HTTP client waits out GitHub's secondary rate limit (detected by response body, not headers), retries transient failures, and reports the reset time when the primary limit is exhausted.

## Development

```bash
npm test              # unit tests (Vitest)
npm run lint          # ESLint
npm run build         # TypeScript
npm run format:check  # Prettier
```

## License

[The MIT License](https://piecioshka.mit-license.org) @ 2026
