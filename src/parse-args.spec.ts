import { describe, expect, it } from 'vitest';

import { parseCliArgs, UsageError } from './parse-args';

describe('parseCliArgs', () => {
  it('parses the owner/repo form', () => {
    const options = parseCliArgs(['piecioshka/super-event-emitter']);
    expect(options.owner).toEqual('piecioshka');
    expect(options.repo).toEqual('super-event-emitter');
  });

  it('parses a full GitHub URL', () => {
    const options = parseCliArgs([
      'https://github.com/piecioshka/super-event-emitter',
    ]);
    expect(options.owner).toEqual('piecioshka');
    expect(options.repo).toEqual('super-event-emitter');
  });

  it('strips a trailing slash and .git suffix from a URL', () => {
    const options = parseCliArgs([
      'https://github.com/piecioshka/super-event-emitter.git/',
    ]);
    expect(options.owner).toEqual('piecioshka');
    expect(options.repo).toEqual('super-event-emitter');
  });

  it('defaults to human output with colors', () => {
    const options = parseCliArgs(['piecioshka/super-event-emitter']);
    expect(options.json).toEqual(false);
    expect(options.color).toEqual(true);
    expect(options.cache).toEqual(true);
  });

  it('recognizes the --json flag', () => {
    const options = parseCliArgs(['--json', 'piecioshka/super-event-emitter']);
    expect(options.json).toEqual(true);
  });

  it('recognizes the --no-color flag', () => {
    const options = parseCliArgs([
      '--no-color',
      'piecioshka/super-event-emitter',
    ]);
    expect(options.color).toEqual(false);
  });

  it('recognizes the --no-cache flag', () => {
    const options = parseCliArgs([
      '--no-cache',
      'piecioshka/super-event-emitter',
    ]);
    expect(options.cache).toEqual(false);
  });

  it('throws UsageError when the repository argument is missing', () => {
    expect(() => parseCliArgs([])).toThrow(UsageError);
  });

  it('throws UsageError for a malformed argument', () => {
    expect(() => parseCliArgs(['not-a-repo'])).toThrow(UsageError);
  });

  it('throws UsageError for an URL outside github.com', () => {
    expect(() => parseCliArgs(['https://gitlab.com/foo/bar'])).toThrow(
      UsageError,
    );
  });

  it('throws UsageError for an unknown flag', () => {
    expect(() =>
      parseCliArgs(['--unknown', 'piecioshka/super-event-emitter']),
    ).toThrow(UsageError);
  });
});
