import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const resolveRepoRootFromModuleUrl = (
  moduleUrl: string,
  override = process.env.IRONQR_REPO_ROOT,
): string => {
  if (override) {
    return path.resolve(override);
  }

  const sourceDirectory = fileURLToPath(new URL('.', moduleUrl));
  return path.resolve(sourceDirectory, '../../..');
};
