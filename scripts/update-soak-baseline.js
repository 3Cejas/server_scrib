const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SUMMARY_PATH = path.join(ROOT_DIR, ".soak-artifacts", "latest-soak-summary.json");
const BASELINE_PATH = path.join(ROOT_DIR, "tests", "fixtures", "soak-latency-baseline.json");

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const summary = await readJson(SUMMARY_PATH);
  const comparisons = {};

  for (const metric of summary.metrics || []) {
    if (typeof metric.maxLatencyMs !== "number") {
      continue;
    }
    comparisons[metric.name] = {
      field: "maxLatencyMs",
      baseline: metric.maxLatencyMs
    };
  }

  const baseline = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceSummary: path.relative(ROOT_DIR, SUMMARY_PATH),
    description: "Baseline latencies for soak regression detection. Refresh after an intentionally accepted performance change.",
    comparisons
  };

  await fsp.writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  process.stdout.write(`Updated ${path.relative(ROOT_DIR, BASELINE_PATH)} from ${path.relative(ROOT_DIR, SUMMARY_PATH)}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
