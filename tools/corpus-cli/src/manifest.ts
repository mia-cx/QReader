import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as S from 'effect/Schema';
import { isEnoentError } from './fs-error.js';
import { normalizeUrlForDedup } from './import/remote/stage-store.js';
import {
  type CorpusManifest,
  CorpusManifestSchema,
  type CorpusRejectionEntry,
  type CorpusRejectionsLog,
  CorpusRejectionsLogSchema,
  type ScrapeProgress,
  ScrapeProgressSchema,
} from './schema.js';
import { assertCompatibleVersion, MAJOR_VERSION } from './version.js';

const provenanceSortKey = (
  record: CorpusManifest['assets'][number]['provenance'][number],
): string => {
  return record.kind === 'local'
    ? `local:${record.originalPath}`
    : `remote:${record.sourcePageUrl}:${record.imageUrl}`;
};

/** Return the absolute path to the `corpus/data` directory. */
export const getCorpusDataRoot = (repoRoot: string): string => {
  return path.join(repoRoot, 'corpus', 'data');
};

/** Return the absolute path to the `corpus/data/assets` directory. */
export const getCorpusAssetsRoot = (repoRoot: string): string => {
  return path.join(getCorpusDataRoot(repoRoot), 'assets');
};

/** Return the absolute path to `corpus/data/manifest.json`. */
export const getCorpusManifestPath = (repoRoot: string): string => {
  return path.join(getCorpusDataRoot(repoRoot), 'manifest.json');
};

/** Return the absolute path to `corpus/data/benchmark-real-world.json`. */
export const getBenchmarkExportPath = (repoRoot: string): string => {
  return path.join(getCorpusDataRoot(repoRoot), 'benchmark-real-world.json');
};

/** Return the absolute path to the perfbench real-world fixture directory. */
export const getPerfbenchFixtureRoot = (repoRoot: string): string => {
  return path.join(repoRoot, 'tools', 'perfbench', 'fixtures', 'real-world');
};

/** Return the absolute path to the assets sub-directory inside the perfbench fixture. */
export const getPerfbenchFixtureAssetsRoot = (repoRoot: string): string => {
  return path.join(getPerfbenchFixtureRoot(repoRoot), 'assets');
};

/** Return the absolute path to the perfbench fixture `manifest.json`. */
export const getPerfbenchFixtureManifestPath = (repoRoot: string): string => {
  return path.join(getPerfbenchFixtureRoot(repoRoot), 'manifest.json');
};

/** Create the corpus assets directory if it does not already exist. */
export const ensureCorpusLayout = async (repoRoot: string): Promise<void> => {
  await mkdir(getCorpusAssetsRoot(repoRoot), { recursive: true });
};

/** Read and validate the corpus manifest; returns an empty manifest when the file is absent. */
export const readCorpusManifest = async (repoRoot: string): Promise<CorpusManifest> => {
  const manifestPath = getCorpusManifestPath(repoRoot);

  try {
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = S.decodeUnknownSync(CorpusManifestSchema)(JSON.parse(raw));
    assertCompatibleVersion(manifest.version, manifestPath);
    return manifest;
  } catch (error) {
    if (isEnoentError(error)) {
      return { version: MAJOR_VERSION, assets: [] };
    }

    throw error;
  }
};

/** Write the corpus manifest to disk, sorting assets and provenance entries. */
export const writeCorpusManifest = async (
  repoRoot: string,
  manifest: CorpusManifest,
): Promise<void> => {
  await ensureCorpusLayout(repoRoot);

  const sorted: CorpusManifest = {
    version: MAJOR_VERSION,
    assets: [...manifest.assets]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((asset) => ({
        ...asset,
        provenance: [...asset.provenance].sort((left, right) =>
          provenanceSortKey(left).localeCompare(provenanceSortKey(right)),
        ),
      })),
  };

  await writeFile(getCorpusManifestPath(repoRoot), `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
};

/** Return the absolute path to `corpus/data/rejections.json`. */
export const getCorpusRejectionsPath = (repoRoot: string): string => {
  return path.join(getCorpusDataRoot(repoRoot), 'rejections.json');
};

/** Read the rejections log; returns an empty log when the file is absent. */
export const readCorpusRejections = async (repoRoot: string): Promise<CorpusRejectionsLog> => {
  const rejectionsPath = getCorpusRejectionsPath(repoRoot);
  try {
    const raw = await readFile(rejectionsPath, 'utf8');
    const log = S.decodeUnknownSync(CorpusRejectionsLogSchema)(JSON.parse(raw));
    assertCompatibleVersion(log.version, rejectionsPath);
    return log;
  } catch (error) {
    if (isEnoentError(error)) {
      return { version: MAJOR_VERSION, rejections: [] };
    }
    throw error;
  }
};

/** Append a rejection entry to the log, skipping duplicates by `sourceSha256`. */
export const appendCorpusRejection = async (
  repoRoot: string,
  entry: CorpusRejectionEntry,
): Promise<void> => {
  await ensureCorpusLayout(repoRoot);
  const log = await readCorpusRejections(repoRoot);
  if (log.rejections.some((r) => r.sourceSha256 === entry.sourceSha256)) {
    return;
  }
  const updated: CorpusRejectionsLog = {
    version: MAJOR_VERSION,
    rejections: [...log.rejections, entry],
  };
  await writeFile(
    getCorpusRejectionsPath(repoRoot),
    `${JSON.stringify(updated, null, 2)}\n`,
    'utf8',
  );
};

/** Return the absolute path to `corpus/data/scrape-progress.json`. */
export const getCorpusScrapeProgressPath = (repoRoot: string): string =>
  path.join(getCorpusDataRoot(repoRoot), 'scrape-progress.json');

/** Read the scrape-progress file; returns an empty record when the file is absent. */
export const readScrapeProgress = async (repoRoot: string): Promise<ScrapeProgress> => {
  const progressPath = getCorpusScrapeProgressPath(repoRoot);
  try {
    const raw = await readFile(progressPath, 'utf8');
    const progress = S.decodeUnknownSync(ScrapeProgressSchema)(JSON.parse(raw));
    assertCompatibleVersion(progress.version, progressPath);
    return progress;
  } catch (error) {
    if (isEnoentError(error)) {
      return { version: MAJOR_VERSION, visitedSourcePageUrls: [] };
    }
    throw error;
  }
};

/** Record a visited source-page URL in the progress file, skipping if already present. */
export const appendVisitedSourcePage = async (repoRoot: string, url: string): Promise<void> => {
  await ensureCorpusLayout(repoRoot);
  const progress = await readScrapeProgress(repoRoot);
  const normalizedUrl = normalizeUrlForDedup(url);
  const existingNormalized = progress.visitedSourcePageUrls.map(normalizeUrlForDedup);
  if (existingNormalized.includes(normalizedUrl)) return;
  const updated: ScrapeProgress = {
    version: MAJOR_VERSION,
    visitedSourcePageUrls: [...progress.visitedSourcePageUrls, normalizedUrl],
  };
  await writeFile(
    getCorpusScrapeProgressPath(repoRoot),
    `${JSON.stringify(updated, null, 2)}\n`,
    'utf8',
  );
};

/** Convert an absolute `targetPath` to a forward-slash repo-relative path. */
export const toRepoRelativePath = (repoRoot: string, targetPath: string): string => {
  return path.relative(repoRoot, targetPath).split(path.sep).join('/');
};
