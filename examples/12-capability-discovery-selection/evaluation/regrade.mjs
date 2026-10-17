import fs from "node:fs";
import { hashDiscoveryContent } from "ai-capability-framework/discovery";
import {
  canonicalResponseState,
  checkResponseWording,
  WORDING_CHECKER_VERSION
} from "./application.mjs";
import { qualificationReport } from "./report.mjs";
import { QUALIFICATION_WORKFLOWS } from "./qualification-workflows.mjs";
import { byteHash, readSavedCampaign } from "./saved-campaign.mjs";

export const WORKFLOW_REGRADE_VERSION = "workflow-wording-regrade.v1";
const same = (a, b) => hashDiscoveryContent(a) === hashDiscoveryContent(b);
const requireEvidence = (condition) => {
  if (!condition)
    throw new Error("Saved workflow evidence is insufficient for regrading.");
};

/** Reassesses saved wording. Observed delivery, tool work and accounting are untouched. */
export function regradeSavedWorkflow(workflow, scenario, suite) {
  const saved = structuredClone(workflow);
  requireEvidence(
    saved.workflowId === scenario.id &&
      saved.kind === scenario.kind &&
      Array.isArray(saved.tasks) &&
      Array.isArray(saved.failures) &&
      "response" in saved &&
      typeof saved.customerResponse === "string" &&
      typeof saved.fallbackUsed === "boolean" &&
      saved.run?.usage?.totals &&
      Array.isArray(saved.responseChecks)
  );
  requireEvidence(
    saved.tasks.every(
      (task) =>
        typeof task.disposition === "string" &&
        Array.isArray(task.toolOutcomes) &&
        Array.isArray(task.errors)
    ) &&
      Array.isArray(saved.executed) &&
      typeof saved.planningValid === "boolean" &&
      typeof saved.planningConsistent === "boolean" &&
      (saved.response === null || typeof saved.response?.summary === "string")
  );
  const canonical = canonicalResponseState(saved.tasks, saved.plan?.decision);
  if (!saved.planningValid || !saved.planningConsistent) canonical.unavailable = true;
  requireEvidence(same(canonical, saved.canonical));
  const facts = structuredClone(
    suite.contexts?.authorized?.runtime_context?.facts?.["example.request"]
  );
  requireEvidence(facts && typeof facts === "object");
  Object.assign(facts, scenario.facts ?? {});
  delete facts.order_id;
  const model =
    saved.response === null
      ? {
          valid: false,
          codes: saved.responseChecks.length
            ? saved.responseChecks
            : ["response_model_unavailable"]
        }
      : checkResponseWording(saved.response, canonical, facts);
  const delivered = checkResponseWording(
    { summary: saved.customerResponse },
    canonical,
    facts
  );
  requireEvidence(
    saved.components?.wording &&
      saved.components?.applicationDelivery &&
      typeof saved.components.operational?.passed === "boolean" &&
      typeof saved.safe === "boolean"
  );
  requireEvidence(
    Number.isSafeInteger(saved.run.pendingAttempts) &&
      saved.run.pendingAttempts >= 0 &&
      ["inputTokens", "outputTokens", "estimatedCost"].every((key) => {
        const total = saved.run.usage.totals[key];
        return (
          total &&
          typeof total.complete === "boolean" &&
          Number.isFinite(total.knownSubtotal) &&
          total.knownSubtotal >= 0 &&
          (total.complete ? total.total === total.knownSubtotal : total.total === null)
        );
      })
  );
  const failures = saved.failures.filter((code) => code !== "application_response");
  if (!delivered.valid) failures.push("application_response");
  const accountingComplete =
    saved.run.pendingAttempts === 0 &&
    ["inputTokens", "outputTokens", "estimatedCost"].every(
      (key) => saved.run.usage.totals[key]?.complete === true
    );
  requireEvidence(
    saved.components.applicationDelivery.passed === (saved.failures.length === 0) &&
      saved.components.wording.passed ===
        (saved.response !== null && !saved.fallbackUsed) &&
      same(saved.responseChecks, saved.components.wording.checks) &&
      saved.passed ===
        (!saved.failures.length &&
          accountingComplete &&
          saved.components.operational.passed &&
          !saved.fallbackUsed)
  );
  const passed =
    !failures.length &&
    saved.safe &&
    accountingComplete &&
    saved.components.operational.passed &&
    model.valid;
  const assessed = {
    ...saved,
    failures,
    passed,
    responseChecks: model.codes,
    components: {
      ...saved.components,
      applicationDelivery: {
        ...saved.components.applicationDelivery,
        passed: !failures.length
      },
      wording: {
        performed: saved.response !== null,
        passed: model.valid,
        checks: model.codes
      }
    }
  };
  return {
    assessed,
    comparison: {
      workflowId: saved.workflowId,
      mode: saved.mode,
      original: {
        passed: saved.passed,
        wording: saved.components.wording,
        delivery: saved.components.applicationDelivery,
        failures: saved.failures
      },
      revised: {
        passed,
        wording: assessed.components.wording,
        delivery: assessed.components.applicationDelivery,
        deliveredChecks: delivered.codes,
        failures
      },
      observed: {
        fallbackUsed: saved.fallbackUsed,
        responseHash: hashDiscoveryContent(saved.response),
        customerResponseHash: hashDiscoveryContent(saved.customerResponse),
        executionHash: hashDiscoveryContent(saved.executed),
        usageHash: hashDiscoveryContent(saved.run)
      }
    }
  };
}

const sourceFiles = [
  "application.mjs",
  "wording.mjs",
  "regrade.mjs",
  "saved-campaign.mjs",
  "report.mjs",
  "campaign.mjs",
  "freeze.mjs",
  "qualification-workflows.mjs"
];
const summarize = (report, workflows) => ({
  workflowPassed: workflows.filter((w) => w.passed).length,
  workflowTotal: workflows.length,
  modes: Object.fromEntries(
    Object.entries(report.modes).map(([mode, value]) => [
      mode,
      {
        qualified: value.qualified,
        matching:
          value.full.decision.qualified &&
          value.held.every((h) => h.decision.qualified),
        workflowPassed: workflows.filter((w) => w.mode === mode && w.passed).length,
        workflowTotal: workflows.filter((w) => w.mode === mode).length,
        workflowQualified: value.workflow.qualified,
        ...(value.incrementalGain === undefined
          ? {}
          : { incrementalGain: value.incrementalGain })
      }
    ])
  )
});

export function regradeSavedCampaign(inputPath) {
  const evidence = readSavedCampaign(inputPath);
  const { suite, registry, workflows, original, taskValues, ledger } = evidence;
  const reproduced = qualificationReport(
    suite,
    registry,
    taskValues,
    workflows,
    8,
    ledger
  );
  requireEvidence(same(reproduced, original.report));
  const assessed = workflows.map((workflow) => {
    const scenario = QUALIFICATION_WORKFLOWS.find(
      (entry) => entry.id === workflow.workflowId
    );
    const result = regradeSavedWorkflow(workflow, scenario, suite);
    result.comparison.sourceArtifact =
      evidence.trialArtifacts[
        `workflow.${workflow.workflowId}.${workflow.mode.replace("/", ".")}`
      ];
    return result;
  });
  const regraded = assessed.map((entry) => entry.assessed);
  const revisedReport = qualificationReport(
    suite,
    registry,
    taskValues,
    regraded,
    8,
    ledger
  );
  requireEvidence(
    revisedReport.complete && same(revisedReport.ledger, original.report.ledger)
  );
  for (const [mode, prior] of Object.entries(original.report.modes)) {
    const next = revisedReport.modes[mode];
    requireEvidence(
      same(
        [prior.full, prior.held, prior.calibrationBaseline, prior.consistency],
        [next.full, next.held, next.calibrationBaseline, next.consistency]
      )
    );
  }
  const sourceHashes = Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      byteHash(fs.readFileSync(new URL(file, import.meta.url)))
    ])
  );
  sourceHashes["run-evaluation-regrade.mjs"] = byteHash(
    fs.readFileSync(new URL("../run-evaluation-regrade.mjs", import.meta.url))
  );
  const inputBindings = {
    campaignFingerprint: evidence.manifest.campaignFingerprint,
    campaignSourceFingerprint: evidence.binding.sourceFingerprint,
    journalHash: evidence.manifest.journalHash,
    originalReportHash: evidence.manifest.reportHash,
    suiteFingerprint: evidence.binding.suiteFingerprint,
    workflowsFingerprint: evidence.binding.workflowsFingerprint,
    artifacts: evidence.artifacts
  };
  const value = {
    schemaVersion: "1.0",
    kind: "offline_wording_regrade",
    checkerVersion: WORDING_CHECKER_VERSION,
    regraderVersion: WORKFLOW_REGRADE_VERSION,
    inputFingerprint: hashDiscoveryContent(inputBindings),
    inputBindings,
    regraderSourceHashes: sourceHashes,
    regraderSourceFingerprint: hashDiscoveryContent(sourceHashes),
    executionUsage: {
      providerAttempts: 0,
      httpRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      complete: true
    },
    original: summarize(original.report, workflows),
    revised: summarize(revisedReport, regraded),
    workflowAssessments: assessed.map((entry) => entry.comparison),
    revisedReport,
    limitation:
      "Offline reassessment of saved live evidence; no new trials, model responses, delivery or tool work. Observed fallbacks remain unchanged. Hybrid promotion gates are unchanged."
  };
  return {
    value: { ...value, reportFingerprint: hashDiscoveryContent(value) },
    evidence
  };
}
