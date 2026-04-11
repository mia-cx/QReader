export const buildFilteredCliCommand = (command?: string, args: readonly string[] = []): string => {
  const prefix = 'bun --filter ironqr-corpus-cli run cli --';
  if (!command) {
    return prefix;
  }

  const renderedArgs = args.map((value) => JSON.stringify(value)).join(' ');
  return renderedArgs.length > 0 ? `${prefix} ${command} ${renderedArgs}` : `${prefix} ${command}`;
};

export const getUsageText = (): string => {
  return `Usage:
  ${buildFilteredCliCommand()}
  ${buildFilteredCliCommand('scrape')} [--limit 25] <seed-urls...>
  ${buildFilteredCliCommand('review')} [<stage-dir>] [--reviewer github-login]
  ${buildFilteredCliCommand('import')} [<files...>|<stage-dir>] [--label qr-positive|non-qr-negative] [--review pending|approved|rejected]
  ${buildFilteredCliCommand('build-bench')} [<asset-id...>]

Global flags:
  --verbose / -v    log skipped candidates, same-host redirects, and other scrape details

Notes:
  - no subcommand = guided scrape → review → import flow
  - missing required args prompt in TTY sessions
  - build-bench writes committed perfbench fixture under tools/perfbench/fixtures/real-world/`;
};
