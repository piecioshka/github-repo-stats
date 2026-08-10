import { describe, expect, it } from 'vitest';

import { makeReport } from '../testing/fixtures';
import { buildJsonPayload } from './json';

const REPORT = makeReport({ errors: { releases: 'boom' } });

describe('buildJsonPayload', () => {
  it('exposes a stable top-level shape', () => {
    const payload = buildJsonPayload(REPORT);
    expect(Object.keys(payload)).toEqual([
      'repository',
      'popularity',
      'activity',
      'issues',
      'releases',
      'timeline',
      'traffic',
      'errors',
    ]);
  });

  it('keeps failed sections as null', () => {
    const payload = buildJsonPayload(REPORT);
    expect(payload.releases).toBeNull();
    expect(payload.errors).toEqual({ releases: 'boom' });
  });

  it('serializes to valid JSON', () => {
    const text = JSON.stringify(buildJsonPayload(REPORT));
    expect(JSON.parse(text).repository.fullName).toEqual('a/b');
  });
});
