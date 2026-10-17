import { randomUUID } from "node:crypto";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { runCampaign } from "./evaluation/runner.mjs";
import { createMockHost } from "./evaluation/mock-host.mjs";

const directory = path.resolve(".aicf/discovery-evaluation", `mock-${randomUUID()}`);
const result = await runCampaign({ directory, mockFactory: createMockHost });
writeFileSync(
  path.join(directory, "report.json"),
  JSON.stringify(result, null, 2) + "\n"
);
if (
  !result.report?.complete ||
  result.report.ledger.pendingReservations ||
  result.report.semanticQualityQualified ||
  Object.values(result.report.modes).some((mode) => !mode.workflow.qualified)
)
  throw new Error("Mock campaign integration did not satisfy its offline contract.");
console.log(
  JSON.stringify(
    {
      status: result.status,
      liveProviderCalls: 0,
      campaignFingerprint: result.campaignFingerprint,
      indexFingerprint: result.indexFingerprint,
      ledger: result.report.ledger,
      workflows: Object.fromEntries(
        Object.entries(result.report.modes).map(([mode, value]) => [
          mode,
          value.workflow
        ])
      ),
      evidenceDirectory: directory,
      semanticQualityQualified: false
    },
    null,
    2
  )
);
