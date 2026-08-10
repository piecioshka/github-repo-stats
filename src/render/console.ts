import { styleText } from 'node:util';

import { Report } from '../collect';

export interface RenderOptions {
  color: boolean;
}

type Style = Parameters<typeof styleText>[0];
type Printer = ReturnType<typeof createPrinter>;

const LABEL_WIDTH = 14;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function createPrinter(color: boolean) {
  const lines: string[] = [];
  const paint = (style: Style, text: string): string =>
    color ? styleText(style, text) : text;

  return {
    paint,
    line: (text: string) => lines.push(text),
    section: (title: string) => {
      lines.push('');
      lines.push(paint(['bold', 'underline'], title));
    },
    row: (label: string, value: string) => {
      lines.push(`  ${label.padEnd(LABEL_WIDTH)} ${value}`);
    },
    note: (text: string) => {
      lines.push(`  ${paint('yellow', text)}`);
    },
    output: () => `${lines.join('\n')}\n`,
  };
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function renderHeader(printer: Printer, report: Report): void {
  const { repo } = report;
  printer.line(printer.paint(['bold', 'cyan'], repo.fullName));
  if (repo.description) {
    printer.line(repo.description);
  }
}

function renderOverview(printer: Printer, report: Report): void {
  const { repo } = report;
  const flags = [
    repo.isArchived && printer.paint('red', 'archived'),
    repo.isFork && 'fork',
  ].filter((flag) => typeof flag === 'string');

  printer.section('Overview');
  printer.row('URL', repo.htmlUrl);
  printer.row(
    'Visibility',
    repo.isPrivate
      ? printer.paint('yellow', 'private')
      : printer.paint('green', 'public'),
  );
  if (flags.length > 0) {
    printer.row('Flags', flags.join(', '));
  }
  printer.row('Language', repo.language ?? '—');
  printer.row('License', repo.license ?? '—');
  printer.row('Created', formatDate(repo.createdAt));
  printer.row('Default branch', repo.defaultBranch);
  printer.row('Size', `${formatNumber(repo.sizeKb)} kB`);
  if (repo.topics.length > 0) {
    printer.row('Topics', repo.topics.join(', '));
  }
}

function renderPopularity(printer: Printer, report: Report): void {
  printer.section('Popularity');
  printer.row('Stars', formatNumber(report.popularity.stars));
  printer.row('Forks', formatNumber(report.popularity.forks));
  printer.row('Watchers', formatNumber(report.popularity.watchers));
}

function renderActivity(printer: Printer, report: Report): void {
  const { lastPushAt, commitsLast52Weeks, contributors } = report.activity;

  printer.section('Activity');
  printer.row('Last push', formatDate(lastPushAt));
  printer.row(
    'Commits (52w)',
    commitsLast52Weeks === null
      ? 'still being computed by GitHub'
      : formatNumber(commitsLast52Weeks),
  );
  if (contributors) {
    const count = formatNumber(contributors.count);
    printer.row('Contributors', contributors.capped ? `${count}+` : count);
  }
  if (report.errors.activity) {
    printer.note(`Section incomplete: ${report.errors.activity}`);
  }
}

function renderIssues(printer: Printer, report: Report): void {
  printer.section('Issues / Pull requests');
  if (report.issues) {
    printer.row('Open issues', formatNumber(report.issues.openIssues));
    printer.row('Open PRs', formatNumber(report.issues.openPulls));
  }
  if (report.errors.issues) {
    printer.note(`Section unavailable: ${report.errors.issues}`);
  }
}

function renderReleases(printer: Printer, report: Report): void {
  printer.section('Releases');
  if (report.errors.releases) {
    printer.note(`Section unavailable: ${report.errors.releases}`);
  } else if (report.releases) {
    const { count, latest, totalDownloads } = report.releases;
    printer.row('Count', formatNumber(count));
    printer.row('Latest', `${latest.tag} (${formatDate(latest.createdAt)})`);
    printer.row('Downloads', formatNumber(totalDownloads));
  } else {
    printer.note('No releases');
  }
}

function renderTimeline(printer: Printer, report: Report): void {
  printer.section('Timeline');
  for (const event of report.timeline) {
    // Pad before painting — ANSI codes would break padEnd's math.
    const date = printer.paint(
      'green',
      formatDate(event.date).padEnd(LABEL_WIDTH),
    );
    const detail = event.detail ? ` (${event.detail})` : '';
    const gap = event.gap ? printer.paint('gray', ` — ${event.gap}`) : '';
    printer.line(`  ${date} ${event.label}${detail}${gap}`);
  }
  if (report.errors.timeline) {
    printer.note(`Timeline incomplete: ${report.errors.timeline}`);
  }
}

function renderTraffic(printer: Printer, report: Report): void {
  printer.section('Traffic (last 14 days)');
  if (report.traffic?.available) {
    const { views, clones, referrers, paths } = report.traffic;
    printer.row(
      'Views',
      `${formatNumber(views.count)} (${views.uniques} unique)`,
    );
    printer.row(
      'Clones',
      `${formatNumber(clones.count)} (${clones.uniques} unique)`,
    );
    for (const referrer of referrers.slice(0, 5)) {
      printer.row('Referrer', `${referrer.referrer} (${referrer.count})`);
    }
    for (const path of paths.slice(0, 5)) {
      printer.row('Path', `${path.path} (${path.count})`);
    }
  } else if (report.traffic) {
    const hint =
      report.traffic.reason === 'requires authentication'
        ? ' (set GITHUB_TOKEN)'
        : '';
    printer.note(`Unavailable: ${report.traffic.reason}${hint}`);
  } else if (report.errors.traffic) {
    printer.note(`Section unavailable: ${report.errors.traffic}`);
  }
}

export function renderReport(report: Report, options: RenderOptions): string {
  const printer = createPrinter(options.color);

  renderHeader(printer, report);
  renderOverview(printer, report);
  renderPopularity(printer, report);
  renderActivity(printer, report);
  renderIssues(printer, report);
  renderReleases(printer, report);
  renderTimeline(printer, report);
  renderTraffic(printer, report);

  return printer.output();
}
