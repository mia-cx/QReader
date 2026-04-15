import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isEnoentError } from './fs-error.js';

export type ViewerPreference =
  | { readonly mode: 'default' }
  | { readonly mode: 'quicklook' }
  | { readonly mode: 'preview' }
  | { readonly mode: 'custom-app'; readonly value: string };

const isViewerPreference = (value: unknown): value is ViewerPreference => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const mode = Reflect.get(value, 'mode');
  if (mode === 'default' || mode === 'quicklook' || mode === 'preview') {
    return true;
  }

  return mode === 'custom-app' && typeof Reflect.get(value, 'value') === 'string';
};

export const getCorpusCliConfigPath = (repoRoot: string): string => {
  return path.join(repoRoot, '.sc', 'corpus-cli.json');
};

export const readViewerPreference = async (
  repoRoot: string,
): Promise<ViewerPreference | undefined> => {
  try {
    const raw = await readFile(getCorpusCliConfigPath(repoRoot), 'utf8');
    const parsed = JSON.parse(raw) as { viewer?: unknown };
    return isViewerPreference(parsed.viewer) ? parsed.viewer : undefined;
  } catch (error) {
    if (isEnoentError(error)) {
      return undefined;
    }

    throw error;
  }
};

export const writeViewerPreference = async (
  repoRoot: string,
  viewer: ViewerPreference,
): Promise<void> => {
  const configPath = getCorpusCliConfigPath(repoRoot);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ viewer }, null, 2)}\n`, 'utf8');
};
