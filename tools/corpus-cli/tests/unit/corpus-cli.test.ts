import { describe, expect, it } from 'bun:test';
import { parseArgv } from '../../src/args.js';
import {
  buildFilteredCliCommand,
  buildOpenTargetInvocation,
  getUsageText,
  resolveRepoRootFromModuleUrl,
} from '../../src/cli.js';

describe('corpus cli helpers', () => {
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

  it('derives repo root from CLI module location', () => {
    expect(
      resolveRepoRootFromModuleUrl(
        'file:///Users/mia/Development/mia-cx/QReader/tools/corpus-cli/src/cli.ts',
      ),
    ).toBe('/Users/mia/Development/mia-cx/QReader');
  });

  it('prefers explicit repo root override', () => {
    expect(
      resolveRepoRootFromModuleUrl(
        'file:///Users/mia/Development/mia-cx/QReader/tools/corpus-cli/src/cli.ts',
        '/tmp/ironqr-root',
      ),
    ).toBe('/tmp/ironqr-root');
  });

  it('prints new command surface in usage text', () => {
    const usage = getUsageText();

    expect(usage).toContain('build-bench');
    expect(usage).toContain('guided scrape → review → import flow');
    expect(usage).not.toContain('import-local');
    expect(usage).not.toContain('export-benchmark');
  });

  it('formats filtered CLI follow-up commands', () => {
    expect(buildFilteredCliCommand('import', ['/tmp/stage-dir'])).toBe(
      'bun --filter ironqr-corpus-cli run cli -- import "/tmp/stage-dir"',
    );
  });

  it('parses new command names and flags', () => {
    expect(
      parseArgv(['scrape', '--label', 'qr-positive', '--limit', '10', 'https://example.com']),
    ).toEqual({
      command: 'scrape',
      help: false,
      options: {
        label: 'qr-positive',
        limit: '10',
      },
      positionals: ['https://example.com'],
    });
  });
});
