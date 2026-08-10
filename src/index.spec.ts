import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from './index';

describe('run', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prints usage and returns 1 for missing arguments', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = await run([]);

    expect(exitCode).toEqual(1);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Usage:');
  });

  it('reports a missing repository and returns 1 on 404', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
        }),
      ),
    );

    const exitCode = await run(['a/does-not-exist']);

    expect(exitCode).toEqual(1);
    expect(errorSpy.mock.calls.flat().join('\n')).toMatch(
      /does not exist or is private/,
    );
  });
});
