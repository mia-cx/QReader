import path from 'node:path';
import { getOption, type ParsedArgs, parseLimit } from '../args.js';
import { buildFilteredCliCommand } from '../command-text.js';
import type { AppContext } from '../context.js';
import { type ScrapeRemoteAssetsResult, scrapeRemoteAssets } from '../import/remote.js';
import { assertInteractiveSession } from '../tty.js';
import { splitUrlInput } from './shared.js';

interface ScrapeInputs {
  readonly seedUrls: readonly string[];
  readonly limit?: number;
}

export const resolveScrapeInputs = async (
  context: AppContext,
  args: ParsedArgs,
): Promise<ScrapeInputs> => {
  let seedUrls = [...args.positionals];
  if (seedUrls.length === 0) {
    assertInteractiveSession('Seed URL required in non-interactive mode');
    seedUrls = splitUrlInput(
      await context.ui.text({
        message: 'Seed URL(s), separated by spaces or commas',
        placeholder: 'https://pixabay.com/images/search/qr%20code/',
        validate: (value) =>
          splitUrlInput(value).length > 0 ? undefined : 'At least one URL is required',
      }),
    );
  }

  let limit = getOption(args, 'limit') ? parseLimit(getOption(args, 'limit')) : undefined;
  if (getOption(args, 'limit') === undefined && process.stdin.isTTY && process.stdout.isTTY) {
    limit = parseLimit(
      await context.ui.text({
        message: 'How many images should be staged this round?',
        initialValue: '25',
        validate: (value) => {
          try {
            parseLimit(value);
            return undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
      }),
    );
  }

  return { seedUrls, ...(limit ? { limit } : {}) };
};

export const runScrapeCommand = async (
  context: AppContext,
  args: ParsedArgs,
): Promise<ScrapeRemoteAssetsResult> => {
  const inputs = await resolveScrapeInputs(context, args);
  const runScrape = () =>
    scrapeRemoteAssets({
      repoRoot: context.repoRoot,
      seedUrls: inputs.seedUrls,
      label: 'qr-positive',
      ...(inputs.limit ? { limit: inputs.limit } : {}),
      fetchDelayMs: 1000,
      log: (line) => {
        if (context.ui.verbose) {
          context.ui.debug(line);
        }
      },
    });

  const result = context.ui.verbose
    ? await runScrape()
    : await context.ui.spin('Scraping remote assets', runScrape);

  context.ui.info(
    `Staged ${result.assets.length} image(s) in ${path.relative(context.repoRoot, result.stageDir)}`,
  );
  if (result.assets.length > 0) {
    context.ui.info(`Next: ${buildFilteredCliCommand('review', [result.stageDir])}`);
  }
  return result;
};
