import path from 'node:path';
import { getOption, type ParsedArgs } from '../args.js';
import { buildFilteredCliCommand } from '../command-text.js';
import type { AppContext } from '../context.js';
import { resolveStagedAssetPath } from '../import/remote.js';
import { type ReviewAction, type ReviewSummary, reviewStagedAssets } from '../review.js';
import { scanLocalImageFile } from '../scan.js';
import {
  promptManualGroundTruth,
  promptQrCount,
  promptStageDir,
  resolveReviewer,
} from './shared.js';

interface ReviewCommandResult {
  readonly stageDir: string;
  readonly reviewer: string;
  readonly summary: ReviewSummary;
}

const promptAction = (context: AppContext, assetId: string): Promise<ReviewAction> => {
  return context.ui.select({
    message: `Review ${assetId}`,
    options: [
      { value: 'approve', label: 'approve', hint: 'approve and capture truth' },
      { value: 'reject', label: 'reject', hint: 'reject with notes' },
      { value: 'skip', label: 'skip', hint: 'mark skipped for now' },
      { value: 'open-source', label: 'open source', hint: 'open source page in browser' },
      { value: 'open-image', label: 'open image', hint: 'open staged image locally' },
      { value: 'quit', label: 'quit', hint: 'stop review loop' },
    ],
  });
};

export const runReviewCommand = async (
  context: AppContext,
  args: ParsedArgs,
  explicitStageDir?: string,
): Promise<ReviewCommandResult> => {
  const stageDir = await promptStageDir(context, explicitStageDir ?? args.positionals[0]);
  const reviewer = await resolveReviewer(context, getOption(args, 'reviewer'));

  if (!reviewer) {
    throw new Error('Reviewer GitHub username is required for review');
  }

  const summary = await reviewStagedAssets({
    stageDir,
    reviewer,
    chooseAction: async (asset) => promptAction(context, asset.id),
    promptRejectionNotes: async () => {
      const notes = await context.ui.text({ message: 'Rejection notes (optional)' });
      return notes.trim().length > 0 ? notes.trim() : undefined;
    },
    promptConfirmedLicense: async (asset, suggestedLicense) => {
      const value = await context.ui.text({
        message: `Confirmed license for ${asset.id}`,
        ...(suggestedLicense ? { initialValue: suggestedLicense } : {}),
      });
      return value.trim().length > 0 ? value.trim() : undefined;
    },
    promptQrCount: async () =>
      promptQrCount(context.ui, 'How many QR codes are present in this image?'),
    confirmAcceptAutoScan: async () =>
      context.ui.confirm({
        message: 'Accept auto-scan results as ground truth?',
        initialValue: false,
      }),
    promptManualGroundTruth: async (_, qrCount) => promptManualGroundTruth(context.ui, qrCount),
    scanAsset: async (asset) =>
      context.ui.spin(`Scanning ${asset.id}`, async () => {
        const imagePath = resolveStagedAssetPath(stageDir, asset.id, asset.imageFileName);
        return scanLocalImageFile(imagePath);
      }),
    openLocalImage: context.openTarget,
    openSourcePage: context.openTarget,
    log: (line) => context.ui.info(line),
  });

  context.ui.info(
    `Review complete: ${summary.approved} approved, ${summary.rejected} rejected, ${summary.skipped} skipped${summary.quitEarly ? ' (quit early)' : ''}`,
  );
  context.ui.info(`Next: ${buildFilteredCliCommand('import', [stageDir])}`);

  return {
    stageDir: path.resolve(stageDir),
    reviewer,
    summary,
  };
};
