import type {
  ProviderConformanceReport,
  ProviderConformanceReportFormat
} from "./types.js";

export function formatProviderConformanceReport(
  report: ProviderConformanceReport,
  format: ProviderConformanceReportFormat = "text"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const lines = [
    `Provider conformance ${report.passed ? "passed" : "failed"}: ${report.counts.passed}/${report.counts.results} result(s) passed across ${report.counts.providers} provider(s).`
  ];
  for (const result of report.results) {
    lines.push(`- ${result.passed ? "passed" : "failed"} ${result.provider} ${result.caseId}`);
    for (const diagnostic of result.diagnostics) {
      lines.push(`  - ${diagnostic}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
