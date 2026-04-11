import {
  readStagedRemoteAssets,
  resolveStagedAssetPath,
  type StagedRemoteAsset,
  type StageReviewStatus,
  updateStagedRemoteAsset,
} from './import/remote.js';
import type { AutoScan, GroundTruth } from './schema.js';
import { assertHttpUrl } from './url.js';

interface ScanAssetResult {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly results: ReadonlyArray<{
    readonly text: string;
    readonly kind?: string | undefined;
  }>;
}

export type ReviewAction = 'approve' | 'reject' | 'skip' | 'open-source' | 'open-image' | 'quit';

interface ReviewStagedAssetsOptions {
  readonly stageDir: string;
  readonly reviewer: string;
  readonly chooseAction: (asset: StagedRemoteAsset) => Promise<ReviewAction>;
  readonly promptRejectionNotes: (asset: StagedRemoteAsset) => Promise<string | undefined>;
  readonly promptConfirmedLicense: (
    asset: StagedRemoteAsset,
    suggestedLicense?: string,
  ) => Promise<string | undefined>;
  readonly promptQrCount: (asset: StagedRemoteAsset) => Promise<number>;
  readonly confirmAcceptAutoScan: (
    asset: StagedRemoteAsset,
    scanResult: ScanAssetResult,
    qrCount: number,
  ) => Promise<boolean>;
  readonly promptManualGroundTruth: (
    asset: StagedRemoteAsset,
    qrCount: number,
  ) => Promise<GroundTruth>;
  readonly scanAsset: (asset: StagedRemoteAsset) => Promise<ScanAssetResult>;
  readonly openLocalImage: (filePath: string) => Promise<void>;
  readonly openSourcePage: (url: string) => Promise<void>;
  readonly log: (line: string) => void;
}

interface ReviewSummary {
  readonly approved: number;
  readonly rejected: number;
  readonly skipped: number;
  readonly quitEarly: boolean;
}

export const reviewStagedAssets = async (
  options: ReviewStagedAssetsOptions,
): Promise<ReviewSummary> => {
  const assets = await readStagedRemoteAssets(options.stageDir);
  let approved = 0;
  let rejected = 0;
  let skipped = 0;

  for (const asset of assets) {
    if (asset.importedAssetId || asset.review.status !== 'pending') {
      continue;
    }

    const imagePath = resolveStagedAssetPath(options.stageDir, asset.id, asset.imageFileName);
    assertHttpUrl(asset.sourcePageUrl, 'source page URL');

    options.log(`Reviewing ${asset.id}`);
    options.log(`Source: ${asset.sourcePageUrl}`);
    options.log(`Local: ${imagePath}`);

    while (true) {
      const action = await options.chooseAction(asset);

      if (action === 'open-source') {
        await options.openSourcePage(asset.sourcePageUrl);
        continue;
      }

      if (action === 'open-image') {
        await options.openLocalImage(imagePath);
        continue;
      }

      if (action === 'skip') {
        await updateStagedRemoteAsset(options.stageDir, {
          ...asset,
          review: {
            status: 'skipped',
            reviewer: options.reviewer,
            reviewedAt: new Date().toISOString(),
          },
        });
        skipped += 1;
        break;
      }

      if (action === 'quit') {
        return { approved, rejected, skipped, quitEarly: true };
      }

      if (action === 'reject') {
        const notes = await options.promptRejectionNotes(asset);
        await updateStagedRemoteAsset(options.stageDir, {
          ...asset,
          review: {
            status: 'rejected',
            reviewer: options.reviewer,
            reviewedAt: new Date().toISOString(),
            ...(notes ? { notes } : {}),
          },
        });
        rejected += 1;
        break;
      }

      if (action === 'approve') {
        const confirmedLicense = await options.promptConfirmedLicense(
          asset,
          asset.bestEffortLicense,
        );
        const qrCount = await options.promptQrCount(asset);

        const scanResult = await options.scanAsset(asset);
        let groundTruth: GroundTruth;
        let autoScan: AutoScan;

        if (qrCount === 0) {
          groundTruth = { qrCount: 0, codes: [] };
          autoScan = toAutoScan(scanResult, scanResult.results.length === 0);
        } else if (scanResult.succeeded && scanResult.results.length === qrCount) {
          const accept = await options.confirmAcceptAutoScan(asset, scanResult, qrCount);
          if (accept) {
            groundTruth = {
              qrCount,
              codes: scanResult.results.map((entry) => ({
                text: entry.text,
                ...(entry.kind ? { kind: entry.kind } : {}),
              })),
            };
            autoScan = toAutoScan(scanResult, true);
          } else {
            groundTruth = await options.promptManualGroundTruth(asset, qrCount);
            autoScan = toAutoScan(scanResult, false);
          }
        } else {
          groundTruth = await options.promptManualGroundTruth(asset, qrCount);
          autoScan = toAutoScan(scanResult, false);
        }

        await updateStagedRemoteAsset(options.stageDir, {
          ...asset,
          review: {
            status: 'approved',
            reviewer: options.reviewer,
            reviewedAt: new Date().toISOString(),
          },
          ...(confirmedLicense || asset.bestEffortLicense
            ? { confirmedLicense: confirmedLicense || asset.bestEffortLicense }
            : {}),
          groundTruth,
          autoScan,
        });
        approved += 1;
        break;
      }
    }
  }

  return { approved, rejected, skipped, quitEarly: false };
};

const toAutoScan = (result: ScanAssetResult, acceptedAsTruth?: boolean): AutoScan => {
  return {
    attempted: result.attempted,
    succeeded: result.succeeded,
    results: result.results.map((entry) => ({
      text: entry.text,
      ...(entry.kind ? { kind: entry.kind } : {}),
    })),
    ...(acceptedAsTruth !== undefined ? { acceptedAsTruth } : {}),
  };
};

export type { ReviewStagedAssetsOptions, ReviewSummary, ScanAssetResult, StageReviewStatus };
