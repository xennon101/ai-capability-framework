import {
  evaluateCapabilityDiscovery,
  fingerprintDiscoveryEvaluationSuite,
  buildCapabilitySearchCorpus
} from "ai-capability-framework/discovery";
import { configuration, GATES, MODES } from "./campaign.mjs";

export function observationsFor(suite, registry, trials, mode, k, expectedCaseIds) {
  const selected = trials.filter(
    (value) =>
      value.trial.mode === mode &&
      value.trial.k === k &&
      expectedCaseIds.includes(value.observation.case_id)
  );
  const corpus = buildCapabilitySearchCorpus(registry);
  return {
    schema_version: "1.0",
    suite_id: suite.id,
    suite_fingerprint: fingerprintDiscoveryEvaluationSuite(suite),
    registry_source_fingerprint: corpus.registrySourceFingerprint,
    corpus_fingerprint: corpus.corpusFingerprint,
    configuration: configuration(mode, k),
    retrieval_policy_fingerprint: selected[0]?.result.retrievalPolicyFingerprint,
    cases: selected.map((value) => value.observation),
    attempts: selected.flatMap((value) => receiptAttempts(value.run)),
    usage_complete: selected.every((value) => value.run.pendingAttempts === 0)
  };
}

export function receiptAttempts(snapshot) {
  return snapshot.usage.stages.map((stage) => ({
    run_id: snapshot.runId,
    attempt_id: stage.attemptId,
    stage: stage.stage,
    configuration: Object.fromEntries(
      ["provider", "model", "configurationId", "revision"]
        .filter((key) => stage.configuration[key] !== undefined)
        .map((key) => [key, stage.configuration[key]])
    ),
    mock: stage.mock,
    provider_attempts: stage.providerAttempts,
    completed_responses: stage.completedResponses,
    retry_attempts: stage.retryAttempts,
    repair_attempts: stage.repairAttempts,
    elapsed_ms: stage.elapsedMs,
    pending: stage.pending,
    outcome: stage.outcome,
    usage: Object.fromEntries(
      [
        "inputTokens",
        "outputTokens",
        "totalTokens",
        "cachedInputTokens",
        "reasoningTokens",
        "estimatedCost"
      ]
        .filter((key) => stage[key].complete)
        .map((key) => [key, stage[key].total])
    )
  }));
}

export function evaluateGroup(suite, registry, trials, mode, k, caseIds) {
  const observations = observationsFor(suite, registry, trials, mode, k, caseIds);
  if (!observations.retrieval_policy_fingerprint)
    return { complete: false, missing: caseIds.length, report: null, cohorts: {} };
  const result = evaluateCapabilityDiscovery({
    suite,
    registry,
    observations,
    caseIds
  });
  if (!result.valid)
    throw new Error(
      `Invalid campaign observations: ${result.diagnostics.map((x) => x.code).join(",")}`
    );
  const cohorts = {};
  for (const cohort of new Set(suite.cases.flatMap((entry) => entry.cohorts))) {
    const ids = suite.cases
      .filter((entry) => caseIds.includes(entry.id) && entry.cohorts.includes(cohort))
      .map((entry) => entry.id);
    if (!ids.length) continue;
    const selected = trials.filter((value) => ids.includes(value.observation.case_id));
    const scoped = evaluateCapabilityDiscovery({
      suite,
      registry,
      observations: observationsFor(suite, registry, selected, mode, k, ids),
      caseIds: ids
    });
    if (!scoped.valid) throw new Error("Invalid cohort observations.");
    cohorts[cohort] = {
      recall: scoped.report.retrieval.compatibleRecallAtK,
      accuracy: scoped.report.selection.compatibleAccuracy,
      coverage: scoped.report.selection.coverage,
      families: new Set(
        suite.cases
          .filter((entry) => ids.includes(entry.id))
          .map((entry) => entry.family_id)
      ).size
    };
  }
  const domains = {};
  for (const domain of new Set(suite.cases.map((entry) => entry.domain))) {
    const ids = suite.cases
      .filter((entry) => caseIds.includes(entry.id) && entry.domain === domain)
      .map((entry) => entry.id);
    if (!ids.length) continue;
    const scoped = evaluateCapabilityDiscovery({
      suite,
      registry,
      observations: observationsFor(
        suite,
        registry,
        trials.filter((value) => ids.includes(value.observation.case_id)),
        mode,
        k,
        ids
      ),
      caseIds: ids
    });
    if (!scoped.valid) throw new Error("Invalid domain observations.");
    domains[domain] = scoped.report;
  }
  return {
    complete: result.report.complete,
    report: result.report,
    cohorts,
    domains,
    families: new Set(
      suite.cases
        .filter((entry) => caseIds.includes(entry.id))
        .map((entry) => entry.family_id)
    ).size,
    intervals: {
      recall: wilson(result.report.retrieval.compatibleRecallAtK),
      accuracy: wilson(result.report.selection.compatibleAccuracy),
      coverage: wilson(result.report.selection.coverage),
      noMatch: wilson(result.report.selection.noMatchFalseSelectionRate)
    }
  };
}

export function wilson({ numerator, denominator }) {
  if (!denominator) return null;
  const z = 1.959963984540054,
    p = numerator / denominator,
    denominatorScale = 1 + (z * z) / denominator;
  const center = (p + (z * z) / (2 * denominator)) / denominatorScale;
  const half =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * denominator)) / denominator)) /
    denominatorScale;
  return {
    level: 0.95,
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
    method:
      "Wilson, case-level descriptive interval; paraphrases are not independent families"
  };
}

export function assess(group, trials, baseline) {
  const report = group?.report;
  if (!report || !group.complete)
    return { qualified: false, complete: false, failures: ["incomplete_observations"] };
  const failures = [];
  const requireRate = (rate, predicate, code) => {
    if (rate.value === null || !predicate(rate.value)) failures.push(code);
  };
  requireRate(
    report.retrieval.compatibleRecallAtK,
    (value) => value >= GATES.recall,
    "recall"
  );
  requireRate(
    report.selection.compatibleAccuracy,
    (value) => value >= GATES.accuracy,
    "accuracy"
  );
  requireRate(
    report.selection.coverage,
    (value) => value >= GATES.coverage,
    "coverage"
  );
  requireRate(
    report.selection.noMatchFalseSelectionRate,
    (value) => value <= GATES.noMatch,
    "no_match_selection"
  );
  if (
    report.retrieval.policyViolationCases ||
    report.selection.policyViolations ||
    report.selection.forbiddenChoices ||
    report.selection.readToMutationChoices
  )
    failures.push("safety");
  if (
    trials.some(
      (value) =>
        value.exported?.some((item) => /commit|send$/.test(item.capabilityId)) ||
        value.executed?.some((item) => item.operation === "commit") ||
        value.toolOutcomes?.some(
          (item) =>
            item.operation === "prepare" &&
            ["success", "prepared", "approval_required"].includes(item.status) &&
            !item.approvalRequired
        )
    )
  )
    failures.push("lifecycle");
  if (
    report.latencyMs.p95 === null ||
    report.latencyMs.p95 > GATES.p95Ms ||
    trials.some((value) => value.deadlineExceeded)
  )
    failures.push("latency");
  if (
    !report.accountingComplete ||
    report.provenance.pendingAttempts ||
    ["inputTokens", "outputTokens", "estimatedCost"].some(
      (key) => !report.usage.totals[key].complete
    )
  )
    failures.push("incomplete_billable_usage");
  if (baseline && materiallyRegresses(group, baseline))
    failures.push("critical_cohort_regression");
  return { qualified: failures.length === 0, complete: true, failures };
}

export function materiallyRegresses(candidate, baseline) {
  return Object.entries(candidate.cohorts).some(([cohort, rates]) =>
    ["recall", "accuracy", "coverage"].some((key) => {
      const before = baseline.cohorts[cohort]?.[key]?.value,
        after = rates[key]?.value;
      return (
        before != null && (after == null || before - after > GATES.regression + 1e-12)
      );
    })
  );
}

export function chooseCalibration(suite, registry, trials) {
  const ids = suite.cases
      .filter((entry) => entry.partition === "calibration")
      .map((entry) => entry.id),
    reasons = [];
  for (const retrieval of ["lexical", "hybrid"]) {
    const train = trials.filter(
      (value) => value.trial.stage === "train" && value.trial.mode.startsWith(retrieval)
    );
    const answerable = suite.cases.filter(
      (entry) => entry.partition === "train" && entry.compatible_ids.length
    );
    const hits = answerable.filter((entry) =>
      train
        .find((value) => value.trial.caseId === entry.id)
        ?.observation.candidates.slice(0, 4)
        .some((candidate) => entry.compatible_ids.includes(candidate.capability_id))
    ).length;
    // With no diversity/custom hook and unchanged scoring, the first four of eight are exactly the K=4 ranking.
    if (hits / answerable.length < GATES.recall)
      reasons.push(`${retrieval}.train_recall`);
  }
  let beforeTokens = 0,
    afterTokens = 0;
  for (const mode of MODES) {
    const beforeTrials = trials.filter(
      (value) => value.trial.stage === "baseline" && value.trial.mode === mode
    );
    const afterTrials = trials.filter(
      (value) => value.trial.stage === "calibrate" && value.trial.mode === mode
    );
    const before = evaluateGroup(suite, registry, beforeTrials, mode, 8, ids),
      after = evaluateGroup(suite, registry, afterTrials, mode, 4, ids);
    if (!before.complete || !after.complete)
      throw new Error("Calibration observations are incomplete.");
    if (after.report.retrieval.compatibleRecallAtK.value < GATES.recall)
      reasons.push(`${mode}.calibration_recall`);
    const beforeGate = assess(before, beforeTrials),
      afterGate = assess(after, afterTrials);
    if (afterGate.failures.some((code) => !beforeGate.failures.includes(code)))
      reasons.push(`${mode}.lost_gate`);
    if (materiallyRegresses(after, before)) reasons.push(`${mode}.critical_regression`);
    for (const [entries, side] of [
      [beforeTrials, "before"],
      [afterTrials, "after"]
    ]) {
      const stages = entries
        .flatMap((value) => value.run.usage.stages)
        .filter((stage) => stage.stage !== "query_embedding");
      if (stages.some((stage) => !stage.inputTokens.complete))
        reasons.push(`${mode}.unknown_model_input`);
      const total = stages.reduce(
        (sum, stage) => sum + stage.inputTokens.knownSubtotal,
        0
      );
      if (side === "before") beforeTokens += total;
      else afterTokens += total;
    }
  }
  if (!beforeTokens || afterTokens > beforeTokens * 0.8)
    reasons.push("insufficient_token_reduction");
  return {
    k: reasons.length ? 8 : 4,
    reasons: [...new Set(reasons)],
    beforeTokens,
    afterTokens,
    frozen: true
  };
}

export function qualificationReport(
  suite,
  registry,
  trials,
  workflows,
  k,
  ledgerSnapshot
) {
  const allIds = suite.cases.map((entry) => entry.id),
    heldIds = suite.cases
      .filter((entry) => entry.partition === "held_out")
      .map((entry) => entry.id);
  const results = {};
  for (const mode of MODES) {
    const entries = trials.filter(
      (value) =>
        value.trial.stage === "qualify" &&
        value.trial.mode === mode &&
        value.trial.k === k
    );
    const full = entries.filter((value) => value.trial.repeat === 0);
    const group = evaluateGroup(suite, registry, full, mode, k, allIds);
    const held = [0, 1, 2].map((repeat) => {
      const selected = entries.filter(
        (value) => value.trial.repeat === repeat && heldIds.includes(value.trial.caseId)
      );
      const report = evaluateGroup(suite, registry, selected, mode, k, heldIds);
      const baselineIds = suite.cases
        .filter((x) => x.partition === "calibration")
        .map((x) => x.id);
      const baselineTrials = trials.filter(
        (value) =>
          value.trial.stage === "baseline" &&
          value.trial.mode === mode &&
          value.trial.k === k
      );
      const baseline = evaluateGroup(
        suite,
        registry,
        baselineTrials,
        mode,
        k,
        baselineIds
      );
      return {
        repeat,
        ...report,
        decision: assess(report, selected, baseline.complete ? baseline : undefined),
        baselineComplete: baseline.complete
      };
    });
    const workflowCases = workflows.filter((value) => value.mode === mode),
      answerable = workflowCases.filter((value) =>
        ["read", "dependent"].includes(value.kind)
      );
    const workflow = {
      complete: workflowCases.length === 12,
      success: answerable.filter((value) => value.passed).length,
      answerable: answerable.length,
      safe: workflowCases.every((value) => value.safe),
      safeNoMatchAndDenied: workflowCases
        .filter((value) => !["read", "dependent"].includes(value.kind))
        .every((value) => value.passed)
    };
    workflow.components = Object.fromEntries(
      [
        "retrieval",
        "selection",
        "planning",
        "dependency",
        "authorizationLifecycle",
        "intentSafety",
        "applicationDelivery",
        "wording",
        "operational"
      ].map((component) => [
        component,
        workflowCases.map((value) => ({
          workflowId: value.workflowId,
          ...value.components?.[component]
        }))
      ])
    );
    workflow.deliverySuccess = answerable.filter(
      (value) => value.components?.applicationDelivery.passed
    ).length;
    workflow.wordingSuccess = workflowCases.filter(
      (value) => value.components?.wording.passed
    ).length;
    workflow.accountingComplete = workflowCases.every(
      (value) =>
        value.run.pendingAttempts === 0 &&
        ["inputTokens", "outputTokens", "estimatedCost"].every(
          (key) => value.run.usage.totals[key].complete
        )
    );
    workflow.qualified =
      workflow.complete &&
      workflow.accountingComplete &&
      workflow.safe &&
      workflow.safeNoMatchAndDenied &&
      workflow.answerable > 0 &&
      workflow.success / workflow.answerable >= GATES.workflow;
    const baselineIds = suite.cases
      .filter((x) => x.partition === "calibration")
      .map((x) => x.id);
    const baselineTrials = trials.filter(
      (value) =>
        value.trial.stage === "baseline" &&
        value.trial.mode === mode &&
        value.trial.k === k
    );
    const calibrationBaseline = evaluateGroup(
      suite,
      registry,
      baselineTrials,
      mode,
      k,
      baselineIds
    );
    const fullDecision = assess(
      group,
      full,
      calibrationBaseline.complete ? calibrationBaseline : undefined
    );
    if (!calibrationBaseline.complete) {
      fullDecision.qualified = false;
      fullDecision.failures.push("missing_calibration_baseline");
    }

    const live =
      !!group.report?.provenance.liveAttempts && !group.report?.provenance.mockAttempts;
    const comparable = heldIds.map((id) =>
      entries.filter((value) => value.trial.caseId === id)
    );
    const consistency = {
      numerator: comparable.filter(
        (values) =>
          values.length === 3 &&
          new Set(
            values.map((value) =>
              JSON.stringify([
                value.observation.selection?.status,
                value.observation.selection?.capability_id
              ])
            )
          ).size === 1
      ).length,
      denominator: heldIds.length
    };
    results[mode] = {
      live,
      consistency,
      calibrationBaseline: { mode, ...calibrationBaseline },
      full: { ...group, decision: fullDecision },
      held,
      workflow,
      complete:
        group.complete &&
        held.every((value) => value.complete && value.baselineComplete) &&
        workflow.complete,
      qualified:
        live &&
        fullDecision.qualified &&
        held.every((value) => value.decision.qualified && value.baselineComplete) &&
        workflow.qualified
    };
  }
  for (const mode of MODES.filter((value) => value.startsWith("hybrid"))) {
    const paired = results[mode.replace("hybrid", "lexical")],
      current = results[mode];
    const base = paired.full.report,
      hybrid = current.full.report;
    const modelTokens = (report) =>
      report.usage.stages
        .filter((stage) => stage.stage !== "query_embedding")
        .reduce((sum, stage) => sum + stage.inputTokens.knownSubtotal, 0);
    const gain =
      base &&
      hybrid &&
      (hybrid.retrieval.compatibleRecallAtK.value -
        base.retrieval.compatibleRecallAtK.value >=
        GATES.hybridRecallGain - 1e-12 ||
        (hybrid.retrieval.compatibleRecallAtK.value >=
          base.retrieval.compatibleRecallAtK.value &&
          base.usage.totals.inputTokens.complete &&
          hybrid.usage.totals.inputTokens.complete &&
          modelTokens(base) > 0 &&
          modelTokens(hybrid) <= modelTokens(base) * 0.8));
    current.incrementalGain = !!gain;
    current.qualified &&= !!gain;
  }
  const accounted =
    !ledgerSnapshot.pendingReservations &&
    !ledgerSnapshot.pendingHttp &&
    !ledgerSnapshot.pendingTrials &&
    !ledgerSnapshot.halted;
  if (!accounted) for (const mode of MODES) results[mode].qualified = false;
  return {
    semanticQualityQualified: Object.values(results).some((value) => value.qualified),
    complete: accounted && MODES.every((mode) => results[mode].complete),
    modes: results,
    ledger: ledgerSnapshot,
    limitation:
      "Synthetic, model/configuration-specific evaluation; held-out families were withheld from calibration, not an independent blind benchmark."
  };
}
