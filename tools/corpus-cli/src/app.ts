import { parseArgv } from './args.js';
import { getUsageText } from './command-text.js';
import { runBuildBenchCommand } from './commands/build-bench.js';
import { runDefaultFlow } from './commands/default-flow.js';
import { runImportCommand } from './commands/import.js';
import { runReviewCommand } from './commands/review.js';
import { runScanCorpusCommand } from './commands/scan-corpus.js';
import { runScrapeCommand } from './commands/scrape.js';
import type { AppContext } from './context.js';

export const runApp = async (context: AppContext, argv: readonly string[]): Promise<void> => {
  const args = parseArgv(argv);

  if (args.help) {
    context.ui.info(getUsageText());
    return;
  }

  if (!args.command) {
    await runDefaultFlow(context, args);
    return;
  }

  switch (args.command) {
    case 'scrape':
      await runScrapeCommand(context, args);
      return;
    case 'review':
      await runReviewCommand(context, args);
      return;
    case 'import':
      await runImportCommand(context, args);
      return;
    case 'build-bench':
      await runBuildBenchCommand(context, args);
      return;
    case 'scan-corpus':
      await runScanCorpusCommand(context, args);
      return;
    default: {
      const _exhaustive: never = args.command;
      throw new Error(`Unknown command: ${args.command}`);
    }
  }
};
