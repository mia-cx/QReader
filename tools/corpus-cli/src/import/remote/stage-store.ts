import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Effect } from 'effect';
import * as S from 'effect/Schema';
import { readCorpusManifest, readCorpusRejections } from '../../manifest.js';
import { assertHttpUrl } from '../../url.js';
import { type StagedRemoteAsset, StagedRemoteAssetSchema } from './contracts.js';
import { tryPromise } from './effect.js';
import { assertAllowedStagedAssetUrls } from './policy.js';

const decodeStagedAsset = S.decodeUnknownSync(StagedRemoteAssetSchema);
const SAFE_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const assertSafeSlug = (value: string, label: string): void => {
  if (!SAFE_SLUG_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
};

const validateStagedAsset = (asset: StagedRemoteAsset): void => {
  assertSafeSlug(asset.id, 'asset id');
  assertSafeSlug(asset.imageFileName, 'image filename');
  assertHttpUrl(asset.seedUrl, 'seed URL');
  assertHttpUrl(asset.sourcePageUrl, 'source page URL');
  assertHttpUrl(asset.imageUrl, 'image URL');
  assertAllowedStagedAssetUrls(asset);
};

export const getStagingRoot = (repoRoot: string): string => {
  return path.join(repoRoot, 'corpus', 'staging');
};

export const ensureStageDir = (repoRoot: string) => {
  return tryPromise(async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stageDir = path.join(getStagingRoot(repoRoot), timestamp);
    await mkdir(stageDir, { recursive: true });
    return stageDir;
  });
};

const getAssetDir = (stageDir: string, assetId: string): string => {
  return path.join(stageDir, assetId);
};

export const getAssetManifestPath = (stageDir: string, assetId: string): string => {
  return path.join(getAssetDir(stageDir, assetId), 'manifest.json');
};

export const getAssetImagePath = (stageDir: string, asset: StagedRemoteAsset): string => {
  return path.join(getAssetDir(stageDir, asset.id), asset.imageFileName);
};

export const resolveStagedAssetPath = (
  stageDir: string,
  assetId: string,
  fileName: string,
): string => {
  assertSafeSlug(assetId, 'asset id');
  assertSafeSlug(fileName, 'image filename');

  const absoluteStage = path.resolve(stageDir);
  const absoluteTarget = path.resolve(absoluteStage, assetId, fileName);
  const stageWithSep = absoluteStage.endsWith(path.sep)
    ? absoluteStage
    : `${absoluteStage}${path.sep}`;

  if (absoluteTarget !== absoluteStage && !absoluteTarget.startsWith(stageWithSep)) {
    throw new Error(`Staged path escapes stage directory: ${absoluteTarget}`);
  }

  return absoluteTarget;
};

export const writeStagedRemoteAssetEffect = (
  stageDir: string,
  asset: StagedRemoteAsset,
  bytes: Uint8Array,
): Effect.Effect<void, unknown> => {
  return tryPromise(async () => {
    validateStagedAsset(asset);
    const assetDir = getAssetDir(stageDir, asset.id);
    await mkdir(assetDir, { recursive: true });
    await writeFile(path.join(assetDir, asset.imageFileName), bytes);
    await writeFile(
      getAssetManifestPath(stageDir, asset.id),
      `${JSON.stringify(asset, null, 2)}\n`,
      'utf8',
    );
  });
};

export const writeStagedRemoteAsset = (
  stageDir: string,
  asset: StagedRemoteAsset,
  bytes: Uint8Array,
): Promise<void> => {
  return Effect.runPromise(writeStagedRemoteAssetEffect(stageDir, asset, bytes));
};

export const updateStagedRemoteAssetEffect = (
  stageDir: string,
  asset: StagedRemoteAsset,
): Effect.Effect<void, unknown> => {
  return tryPromise(async () => {
    validateStagedAsset(asset);
    await writeFile(
      getAssetManifestPath(stageDir, asset.id),
      `${JSON.stringify(asset, null, 2)}\n`,
      'utf8',
    );
  });
};

export const updateStagedRemoteAsset = (
  stageDir: string,
  asset: StagedRemoteAsset,
): Promise<void> => {
  return Effect.runPromise(updateStagedRemoteAssetEffect(stageDir, asset));
};

export const readStagedRemoteAssetEffect = (
  stageDir: string,
  assetId: string,
): Effect.Effect<StagedRemoteAsset, unknown> => {
  return Effect.gen(function* () {
    assertSafeSlug(assetId, 'asset id');
    const raw = yield* tryPromise(() => readFile(getAssetManifestPath(stageDir, assetId), 'utf8'));
    const asset = decodeStagedAsset(JSON.parse(raw));
    validateStagedAsset(asset);
    return asset;
  });
};

export const readStagedRemoteAsset = (
  stageDir: string,
  assetId: string,
): Promise<StagedRemoteAsset> => {
  return Effect.runPromise(readStagedRemoteAssetEffect(stageDir, assetId));
};

export const readStagedRemoteAssetsEffect = (
  stageDir: string,
): Effect.Effect<readonly StagedRemoteAsset[], unknown> => {
  return Effect.gen(function* () {
    const entries = yield* tryPromise(() => readdir(stageDir, { withFileTypes: true }));
    const assets: StagedRemoteAsset[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      assets.push(yield* readStagedRemoteAssetEffect(stageDir, entry.name));
    }

    return assets.sort((left, right) => left.id.localeCompare(right.id));
  });
};

export const readStagedRemoteAssets = (stageDir: string): Promise<readonly StagedRemoteAsset[]> => {
  return Effect.runPromise(readStagedRemoteAssetsEffect(stageDir));
};

export const removeStagedAssetDirEffect = (stageDir: string, assetId: string) => {
  return tryPromise(async () => {
    assertSafeSlug(assetId, 'asset id');
    await rm(getAssetDir(stageDir, assetId), { recursive: true, force: true });
  });
};

/**
 * Removes the run directory if it is now empty (all assets processed).
 * Silently ignores non-empty or already-gone dirs.
 */
export const removeRunDirIfEmptyEffect = (stageDir: string) => {
  return tryPromise(async () => {
    try {
      await rmdir(stageDir);
    } catch {
      // not empty or already gone — fine
    }
  });
};

export const collectExistingStagedSourceHashesEffect = (repoRoot: string) => {
  return tryPromise(async () => {
    const seenSourceSha256 = new Set<string>();

    // Collect hashes from already-approved corpus assets so scraping never
    // re-presents an image that has already been imported, even after staging
    // directories are cleared.
    const manifest = await readCorpusManifest(repoRoot);
    for (const asset of manifest.assets) {
      if (asset.sourceSha256) {
        seenSourceSha256.add(asset.sourceSha256);
      }
    }

    // Also skip previously rejected images.
    const rejectionsLog = await readCorpusRejections(repoRoot);
    for (const rejection of rejectionsLog.rejections) {
      seenSourceSha256.add(rejection.sourceSha256);
    }

    // Also collect from any remaining staging run dirs (cross-run dedup within
    // the same staging lifetime).
    const stagingRoot = getStagingRoot(repoRoot);
    let runDirs: readonly string[];
    try {
      const entries = await readdir(stagingRoot, { withFileTypes: true });
      runDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(stagingRoot, entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return seenSourceSha256;
      }
      throw error;
    }

    for (const runDir of runDirs) {
      const assetEntries = await readdir(runDir, { withFileTypes: true });
      for (const assetEntry of assetEntries) {
        if (!assetEntry.isDirectory()) continue;
        const manifestPath = path.join(runDir, assetEntry.name, 'manifest.json');
        try {
          const raw = await readFile(manifestPath, 'utf8');
          const parsed = JSON.parse(raw) as { readonly sourceSha256?: unknown };
          if (typeof parsed.sourceSha256 === 'string' && parsed.sourceSha256.length > 0) {
            seenSourceSha256.add(parsed.sourceSha256);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }

    return seenSourceSha256;
  });
};
