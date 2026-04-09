import type { BenchmarkResult } from './runner.js';

const OUTPUT_FILE = `${import.meta.dirname}/../benchmark-results.json`;

export interface BenchmarkReport {
  readonly timestamp: string;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly decodeSuccesses: number;
  readonly decodeFailures: number;
  readonly falsePositives: number;
  readonly decodeRate: number;
  readonly falsePositiveRate: number;
  readonly failedIds: readonly string[];
  readonly falsePositiveIds: readonly string[];
}

export function buildReport(result: BenchmarkResult): BenchmarkReport {
  return {
    timestamp: new Date().toISOString(),
    positiveCount: result.positives.length,
    negativeCount: result.negatives.length,
    decodeSuccesses: result.decodeSuccesses,
    decodeFailures: result.decodeFailures,
    falsePositives: result.falsePositives,
    decodeRate: result.decodeRate,
    falsePositiveRate: result.falsePositiveRate,
    failedIds: result.positives.filter((r) => !r.passed).map((r) => r.entry.id),
    falsePositiveIds: result.negatives.filter((r) => r.falsePositive).map((r) => r.entry.id),
  };
}

export function printSummary(report: BenchmarkReport): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.log('\n── Benchmark Results ──────────────────────────────────');
  console.log(
    `  Positives : ${report.decodeSuccesses}/${report.positiveCount} passed  (decodeRate ${pct(report.decodeRate)})`,
  );
  console.log(
    `  Negatives : ${report.falsePositives} false positives out of ${report.negativeCount}  (falsePositiveRate ${pct(report.falsePositiveRate)})`,
  );
  if (report.failedIds.length > 0) {
    console.log(`  Failed    : ${report.failedIds.join(', ')}`);
  }
  if (report.falsePositiveIds.length > 0) {
    console.log(`  FP ids    : ${report.falsePositiveIds.join(', ')}`);
  }
  console.log(`  Output    : ${OUTPUT_FILE}`);
  console.log('───────────────────────────────────────────────────────\n');
}

export async function writeReport(report: BenchmarkReport): Promise<void> {
  await Bun.write(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`);
}
