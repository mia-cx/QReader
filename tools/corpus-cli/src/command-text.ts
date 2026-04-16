/** Build a `bun --filter` CLI command string for display in help and next-step hints. */
export const buildFilteredCliCommand = (command?: string, args: readonly string[] = []): string => {
  const prefix = 'bun --filter ironqr-corpus-cli run cli --';
  if (!command) {
    return prefix;
  }

  const renderedArgs = args.map((value) => JSON.stringify(value)).join(' ');
  return renderedArgs.length > 0 ? `${prefix} ${command} ${renderedArgs}` : `${prefix} ${command}`;
};

/** Return the full CLI usage/help text shown when no valid subcommand is found. */
export const getUsageText = (): string => {
  return `Usage:
  ${buildFilteredCliCommand()}
  ${buildFilteredCliCommand('scrape')} [--limit 25] <seed-urls...>
  ${buildFilteredCliCommand('review')} [<stage-dir>] [--reviewer github-login]
  ${buildFilteredCliCommand('import')} [<files...>|<stage-dir>] [--label qr-positive|non-qr-negative] [--review pending|approved|rejected]
  ${buildFilteredCliCommand('build-bench')} [<asset-id...>]
  ${buildFilteredCliCommand('scan-corpus')} [--label qr-positive|non-qr-negative] [--failures-only] [--quiet]

Global flags:
  --verbose / -v    log skipped candidates, same-host redirects, and other scrape details

Notes:
  - no subcommand = guided scrape → review → import flow
  - missing required args prompt in TTY sessions
  - build-bench writes committed perfbench fixture under tools/perfbench/fixtures/real-world/
  - scan-corpus runs the production scanner against every approved corpus asset and reports decode/false-positive rates`;
};
