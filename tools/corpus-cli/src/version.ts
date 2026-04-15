import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

/** The major version of the corpus-cli package, used as the data-format compatibility version. */
export const MAJOR_VERSION = Number(pkg.version.split('.')[0]);

/**
 * Throw if `fileVersion` is newer than `MAJOR_VERSION`, indicating an incompatible data file.
 * Older versions (fileVersion <= MAJOR_VERSION) are accepted — the CLI is backward-compatible
 * with data written by earlier versions.
 */
export const assertCompatibleVersion = (fileVersion: number, filePath: string): void => {
  if (fileVersion > MAJOR_VERSION) {
    throw new Error(
      `Incompatible file version: ${filePath} has version ${fileVersion}, but corpus-cli is at major version ${MAJOR_VERSION}. ` +
        `Upgrade corpus-cli or migrate the file.`,
    );
  }
};
