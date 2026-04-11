import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApp } from './app.js';
import { buildFilteredCliCommand, getUsageText } from './command-text.js';
import { createClackUi } from './ui/clack.js';
import { CliCancelledError } from './ui.js';

const detectGithubLogin = (): string | undefined => {
  try {
    const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return login || undefined;
  } catch {
    return undefined;
  }
};

type OpenTargetInvocation = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: {
    readonly stdio: 'ignore';
    readonly detached: true;
    readonly windowsVerbatimArguments?: true;
  };
};

export const buildOpenTargetInvocation = (
  target: string,
  platform: NodeJS.Platform = process.platform,
): OpenTargetInvocation => {
  const options = { stdio: 'ignore' as const, detached: true as const };

  if (platform === 'darwin') {
    return {
      command: 'open',
      args: [target],
      options,
    };
  }

  if (platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/d', '/s', '/c', 'start', '""', `"${target}"`],
      options: {
        ...options,
        windowsVerbatimArguments: true,
      },
    };
  }

  return {
    command: 'xdg-open',
    args: [target],
    options,
  };
};

const openTarget = (target: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const { command, args, options } = buildOpenTargetInvocation(target);
    const child = spawn(command, args, options);

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
};

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

const main = async (): Promise<void> => {
  const ui = createClackUi();

  try {
    await runApp(
      {
        repoRoot: resolveRepoRootFromModuleUrl(import.meta.url),
        ui,
        openTarget,
        detectGithubLogin,
      },
      process.argv.slice(2),
    );
  } catch (error) {
    if (error instanceof CliCancelledError) {
      ui.cancel('Cancelled');
      return;
    }

    throw error;
  }
};

export { buildFilteredCliCommand, getUsageText };

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
