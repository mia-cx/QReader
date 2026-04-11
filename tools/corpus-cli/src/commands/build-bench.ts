import path from 'node:path';
import readline from 'node:readline';
import type { ParsedArgs } from '../args.js';
import type { AppContext } from '../context.js';
import {
  type BenchEligibleAsset,
  listBenchEligibleAssets,
  writeSelectedRealWorldBenchmarkFixture,
} from '../export/benchmark.js';
import { assertInteractiveSession } from '../tty.js';
import { CliCancelledError } from '../ui.js';

const truncate = (value: string, maxLength: number): string => {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
};

const renderAssetRow = (asset: BenchEligibleAsset): string => {
  const snippet = asset.textSnippet ? ` ${JSON.stringify(truncate(asset.textSnippet, 28))}` : '';
  const qrCount = asset.qrCount === null ? 'qr=?' : `qr=${asset.qrCount}`;
  return `${asset.id}  ${asset.label}  ${asset.width}×${asset.height}  ${qrCount}${snippet}`;
};

const selectBenchAssets = async (
  context: AppContext,
  assets: readonly BenchEligibleAsset[],
): Promise<readonly string[]> => {
  assertInteractiveSession('Bench asset selection requires an interactive terminal');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  const selected = new Set<string>();
  let cursor = 0;
  let note = 'space toggle · p/o preview · enter confirm · ctrl+c cancel';
  let previewing = false;

  const render = () => {
    const windowSize = 10;
    const start = Math.max(
      0,
      Math.min(cursor - Math.floor(windowSize / 2), assets.length - windowSize),
    );
    const visible = assets.slice(start, start + windowSize);

    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write('Select perfbench fixture assets\n');
    process.stdout.write(`${note}\n\n`);

    for (let index = 0; index < visible.length; index += 1) {
      const asset = visible[index];
      if (!asset) continue;

      const absoluteIndex = start + index;
      const marker = selected.has(asset.id) ? '[x]' : '[ ]';
      const cursorMarker = absoluteIndex === cursor ? '›' : ' ';
      process.stdout.write(`${cursorMarker} ${marker} ${renderAssetRow(asset)}\n`);
    }
  };

  render();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdout.write('\x1b[2J\x1b[H');
    };

    const finish = (value: readonly string[]) => {
      cleanup();
      resolve(value);
    };

    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };

    const onKeypress = async (_input: string, key: readline.Key) => {
      if (previewing) {
        return;
      }

      if (key.ctrl && key.name === 'c') {
        fail(new CliCancelledError());
        return;
      }

      if (key.name === 'up' || key.name === 'k') {
        cursor = cursor === 0 ? assets.length - 1 : cursor - 1;
        note = 'space toggle · p/o preview · enter confirm · ctrl+c cancel';
        render();
        return;
      }

      if (key.name === 'down' || key.name === 'j') {
        cursor = cursor === assets.length - 1 ? 0 : cursor + 1;
        note = 'space toggle · p/o preview · enter confirm · ctrl+c cancel';
        render();
        return;
      }

      if (key.name === 'space') {
        const current = assets[cursor];
        if (!current) {
          return;
        }

        if (selected.has(current.id)) {
          selected.delete(current.id);
        } else {
          selected.add(current.id);
        }
        note = `${selected.size} selected`;
        render();
        return;
      }

      if (key.name === 'return') {
        if (selected.size === 0) {
          note = 'Select at least one asset';
          render();
          return;
        }

        finish([...selected]);
        return;
      }

      if (key.name === 'p' || key.name === 'o') {
        const current = assets[cursor];
        if (!current) {
          return;
        }

        previewing = true;
        note = `Opening ${path.basename(current.previewPath)}...`;
        render();
        try {
          await context.openTarget(current.previewPath);
          note = `Opened ${path.basename(current.previewPath)}`;
        } catch (error) {
          note = error instanceof Error ? error.message : String(error);
        } finally {
          previewing = false;
          render();
        }
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
};

export const runBuildBenchCommand = async (
  context: AppContext,
  args: ParsedArgs,
): Promise<{ readonly selected: number; readonly outputPath: string }> => {
  const assets = await listBenchEligibleAssets(context.repoRoot);
  if (assets.length === 0) {
    throw new Error('No approved corpus assets available for perfbench fixture');
  }

  const selectedIds =
    args.positionals.length > 0 ? args.positionals : await selectBenchAssets(context, assets);

  const result = await context.ui.spin('Writing committed perfbench fixture', () =>
    writeSelectedRealWorldBenchmarkFixture(context.repoRoot, selectedIds),
  );

  context.ui.info(
    `Wrote ${path.relative(context.repoRoot, result.outputPath)} (${result.corpus.positives.length} positives, ${result.corpus.negatives.length} negatives)`,
  );

  return { selected: selectedIds.length, outputPath: result.outputPath };
};
