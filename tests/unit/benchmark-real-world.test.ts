import { describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runRealWorldBenchmark,
  scoreRealWorldPositive,
} from '../../benchmark/real-world-runner.js';

describe('real-world benchmark runner', () => {
  it('treats a successful scan as passing when no ground truth is present', async () => {
    const result = scoreRealWorldPositive(
      {
        id: 'asset-1',
        label: 'qr-positive',
        assetPath: 'corpus/data/assets/asset-1.webp',
        sha256: 'abc',
        byteLength: 1,
        mediaType: 'image/webp',
      },
      {
        succeeded: true,
        results: [{ text: 'https://example.com' }],
      },
    );

    expect(result.passed).toBe(true);
    expect(result.expectedText).toBe(null);
    expect(result.error).toBe(null);
  });

  it('reports zero counts when the corpus is empty and passes the exit gate', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'qreader-bench-empty-'));
    const result = await runRealWorldBenchmark(repoRoot);

    expect(result.positives).toHaveLength(0);
    expect(result.negatives).toHaveLength(0);
    expect(result.decodeRate).toBe(1);
    expect(result.falsePositiveRate).toBe(0);
  });
});
