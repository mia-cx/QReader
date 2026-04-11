import type { ParsedArgs } from '../args.js';
import type { AppContext } from '../context.js';
import { runBuildBenchCommand } from './build-bench.js';
import { runImportCommand } from './import.js';
import { runReviewCommand } from './review.js';
import { runScrapeCommand } from './scrape.js';

export const runDefaultFlow = async (context: AppContext, args: ParsedArgs): Promise<void> => {
  const scrape = await runScrapeCommand(context, args);
  if (scrape.assets.length === 0) {
    context.ui.outro('No images staged');
    return;
  }

  const review = await runReviewCommand(context, { ...args, positionals: [] }, scrape.stageDir);
  if (review.summary.quitEarly) {
    context.ui.outro('Stopped after review');
    return;
  }

  const shouldImport = await context.ui.confirm({
    message: 'Import approved assets now?',
    initialValue: true,
  });
  if (!shouldImport) {
    context.ui.outro('Review complete');
    return;
  }

  await runImportCommand(context, { ...args, positionals: [] }, scrape.stageDir);

  const shouldBuildBench = await context.ui.confirm({
    message: 'Curate committed perfbench fixture now?',
    initialValue: false,
  });
  if (!shouldBuildBench) {
    context.ui.outro('Import complete');
    return;
  }

  await runBuildBenchCommand(context, { ...args, positionals: [] });
  context.ui.outro('Corpus flow complete');
};
