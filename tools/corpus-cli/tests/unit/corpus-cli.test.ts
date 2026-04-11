import { describe, expect, it } from 'bun:test';
import { buildOpenTargetInvocation } from '../../src/cli.js';

describe('corpus cli opener', () => {
  it('builds a Windows-safe opener invocation', () => {
    const target = 'https://example.com/a?x=1&y=2';

    expect(buildOpenTargetInvocation(target, 'win32')).toEqual({
      command: 'cmd',
      args: ['/d', '/s', '/c', 'start', '""', `"${target}"`],
      options: {
        stdio: 'ignore',
        detached: true,
        windowsVerbatimArguments: true,
      },
    });
  });
});
