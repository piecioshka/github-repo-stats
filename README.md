# github-repo-stats 🔎

![cli-available](https://badgen.net/static/cli/available/?icon=terminal) [![node version](https://img.shields.io/node/v/github-repo-stats.svg)](https://www.npmjs.com/package/github-repo-stats) [![npm version](https://badge.fury.io/js/github-repo-stats.svg)](https://badge.fury.io/js/github-repo-stats) [![downloads count](https://img.shields.io/npm/dt/github-repo-stats.svg)](https://www.npmjs.com/package/github-repo-stats) [![size](https://packagephobia.com/badge?p=github-repo-stats)](https://packagephobia.com/result?p=github-repo-stats) [![license](https://img.shields.io/npm/l/github-repo-stats.svg)](https://piecioshka.mit-license.org) [![github-ci](https://github.com/piecioshka/github-repo-stats/actions/workflows/testing.yml/badge.svg)](https://github.com/piecioshka/github-repo-stats/actions/workflows/testing.yml) ![typescript](https://img.shields.io/badge/built%20with-TypeScript-3178c6.svg)

🔎 CLI to inspect GitHub repository statistics: popularity, activity, issues, releases, timeline, and traffic.

> Give a ⭐️ if this project helped you!

## Preview 🎉

![github-repo-stats demo](demo/demo.gif)

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

Run without installation:

```bash
npx github-repo-stats <owner>/<repo>
```

Or install globally:

```bash
npm install -g github-repo-stats
```

```bash
github-repo-stats <owner>/<repo>
```

Examples:

```bash
github-repo-stats piecioshka/super-event-emitter
github-repo-stats https://github.com/nodejs/node
github-repo-stats piecioshka/super-event-emitter --json
github-repo-stats piecioshka/super-event-emitter --no-color
```

## Authentication (optional)

Without a token the tool uses the anonymous GitHub API limit (60 requests/hour). Generate a token on the [Personal access tokens](https://github.com/settings/personal-access-tokens) page and set the `GITHUB_TOKEN` environment variable to raise the limit and unlock the traffic section:

```bash
GITHUB_TOKEN=ghp_xxx github-repo-stats <owner>/<repo>
```

Alternatively, put the token in a `.env` file in the current working directory (see `.env.example`):

```bash
cp .env.example .env
# edit .env and set GITHUB_TOKEN
github-repo-stats <owner>/<repo>
```

Variables already present in the shell environment take precedence over the `.env` file.

### Required token permissions

Fine-grained tokens (the default on the linked page) start with the mandatory `Metadata: Read-only` permission only. Each report section needs the following access:

| Report section | Fine-grained permission | Classic token scope |
| --- | --- | --- |
| Overview, Popularity, Activity, Timeline | `Metadata: Read-only` | none (`repo` for private) |
| Issues / Pull requests | `Pull requests: Read-only` | none (`repo` for private) |
| Releases | `Contents: Read-only` | none (`repo` for private) |
| Traffic | `Administration: Read-only` | `repo` |

> [!WARNING]
>
> A fine-grained token without these permissions responds with `403 Resource not accessible by personal access token` — the affected sections show an error while the rest of the report still renders.

If you use the [GitHub CLI](https://cli.github.com), the quickest option is reusing its token, which already has the `repo` scope:

```bash
GITHUB_TOKEN=$(gh auth token) github-repo-stats <owner>/<repo>
```

## GitHub Enterprise

Set the `GITHUB_API_URL` environment variable (or put it in `.env`) to point the tool at a GitHub Enterprise instance:

```bash
GITHUB_API_URL=https://github.mycompany.com/api/v3 github-repo-stats <owner>/<repo>
```

When the variable is not set, the tool talks to `https://api.github.com`.

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
