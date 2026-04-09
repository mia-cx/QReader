import { buildReport, printSummary, writeReport } from './report.js';
import { runBenchmark } from './runner.js';

const result = await runBenchmark();
const report = buildReport(result);
printSummary(report);

const shouldFail = report.decodeRate < 1 || report.falsePositiveRate > 0;

try {
  await writeReport(report);
} catch (error) {
  process.stderr.write(`Warning: failed to write benchmark-results.json: ${error}\n`);
}

if (shouldFail) {
  process.exit(1);
}
