import path from 'node:path';
import { getOption, type ParsedArgs, parseLimit } from '../args.js';
import type { AppContext } from '../context.js';
import { readStagedRemoteAssets, startScrapeRemoteAssets } from '../import/remote.js';
import { assertInteractiveSession } from '../tty.js';
import { runBuildBenchCommand } from './build-bench.js';
import { runImportCommand } from './import.js';
import { runReviewCommand } from './review.js';
import { listStageDirectories, resolveReviewer, splitUrlInput } from './shared.js';

const listUnreviewedStageDirs = async (repoRoot: string): Promise<readonly string[]> => {
  const stageDirs = await listStageDirectories(repoRoot);
  const unreviewed: string[] = [];

  for (const stageDir of stageDirs) {
    const assets = await readStagedRemoteAssets(stageDir);
    if (assets.some((asset) => !asset.importedAssetId && asset.review.status === 'pending')) {
      unreviewed.push(stageDir);
    }
  }

  return unreviewed;
};

const promptUnreviewedStageDir = async (
  context: AppContext,
  stageDirs: readonly string[],
): Promise<string> => {
  if (stageDirs.length === 1) {
    const only = stageDirs[0];
    if (!only) {
      throw new Error('Expected unreviewed stage dir');
    }
    return only;
  }

  return context.ui.select({
    message: 'Choose staged run to resume',
    options: stageDirs.map((stageDir) => ({
      value: stageDir,
      label: path.relative(context.repoRoot, stageDir),
    })),
  });
};

const runReviewImportRoundForExistingStageDir = async (
  context: AppContext,
  args: ParsedArgs,
  stageDir: string,
  reviewer: string,
): Promise<void> => {
  const review = await runReviewCommand(context, { ...args, positionals: [] }, stageDir, reviewer);
  if (review.summary.approved > 0) {
    await runImportCommand(context, { ...args, positionals: [] }, stageDir);
  }
};

const resolveSeedUrls = async (
  context: AppContext,
  args: ParsedArgs,
): Promise<readonly string[]> => {
  if (args.positionals.length > 0) {
    return args.positionals;
  }

  assertInteractiveSession('Seed URL required in non-interactive mode');
  return splitUrlInput(
    await context.ui.text({
      message: 'Seed URL(s), separated by spaces or commas',
      placeholder: 'https://pixabay.com/images/search/qr%20code/',
      validate: (value) =>
        splitUrlInput(value).length > 0 ? undefined : 'At least one URL is required',
    }),
  );
};

const resolveStageLimit = async (context: AppContext, args: ParsedArgs): Promise<number> => {
  const explicitLimit = getOption(args, 'limit');
  if (explicitLimit) {
    return parseLimit(explicitLimit);
  }

  assertInteractiveSession('Stage limit required in non-interactive mode');
  return parseLimit(
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
};

const runStreamingRound = async (
  context: AppContext,
  args: ParsedArgs,
  seedUrls: readonly string[],
  limit: number,
  reviewer: string,
): Promise<{ readonly staged: number }> => {
  const session = await startScrapeRemoteAssets({
    repoRoot: context.repoRoot,
    seedUrls,
    label: 'qr-positive',
    limit,
    log: (line) => {
      if (context.ui.verbose) {
        context.ui.debug(line);
      }
    },
  });

  context.ui.info(
    `Scraping into ${path.relative(context.repoRoot, session.stageDir)} — review starts as soon as first image lands`,
  );

  let reviewError: unknown;
  try {
    const review = await runReviewCommand(
      context,
      { ...args, positionals: [] },
      session.stageDir,
      reviewer,
      session.assets,
    );

    if (review.summary.approved > 0) {
      await runImportCommand(context, { ...args, positionals: [] }, session.stageDir);
    }
  } catch (error) {
    reviewError = error;
  }

  const staged = await session.done;
  if (reviewError) {
    throw reviewError;
  }

  return { staged: staged.length };
};

export const runDefaultFlow = async (context: AppContext, args: ParsedArgs): Promise<void> => {
  const reviewer = await resolveReviewer(context);

  const unreviewedStageDirs = await listUnreviewedStageDirs(context.repoRoot);
  if (unreviewedStageDirs.length > 0) {
    const resume = await context.ui.confirm({
      message: 'Found unreviewed staged images from earlier run. Review those first?',
      initialValue: true,
    });

    if (resume) {
      const stageDir = await promptUnreviewedStageDir(context, unreviewedStageDirs);
      await runReviewImportRoundForExistingStageDir(context, args, stageDir, reviewer);
    }
  }

  const seedUrls = await resolveSeedUrls(context, args);

  while (true) {
    const limit = await resolveStageLimit(context, args);
    const { staged } = await runStreamingRound(context, args, seedUrls, limit, reviewer);

    if (staged === 0) {
      context.ui.outro('No images staged this round');
      return;
    }

    const continueScraping = await context.ui.confirm({
      message: 'Scrape another round?',
      initialValue: true,
    });
    if (continueScraping) {
      continue;
    }

    const shouldBuildBench = await context.ui.confirm({
      message: 'Curate committed perfbench fixture now?',
      initialValue: false,
    });
    if (shouldBuildBench) {
      await runBuildBenchCommand(context, { ...args, positionals: [] });
    }

    context.ui.outro('Corpus flow complete');
    return;
  }
};
