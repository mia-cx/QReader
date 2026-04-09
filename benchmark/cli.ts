import { buildReport, printSummary, writeReport } from './report.js';
import { runBenchmark } from './runner.js';

const result = await runBenchmark();
const report = buildReport(result);
printSummary(report);
await writeReport(report);

if (result.decodeRate < 1) {
  process.exit(1);
}
