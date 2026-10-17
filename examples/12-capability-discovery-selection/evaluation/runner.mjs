import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  hashDiscoveryContent,
  fingerprintDiscoveryEvaluationSuite,
  evaluateCapabilityDiscovery
} from "ai-capability-framework/discovery";
import { validatePublicFixtures } from "ai-capability-framework";
import {
  loadSuite,
  registryFor,
  campaignBinding,
  validateDataset,
  trialSchedule,
  CAPS,
  MODES,
  EXECUTION
} from "./campaign.mjs";
import { WORKFLOWS as DEVELOPMENT_WORKFLOWS } from "./workflow-cases.mjs";
import { QUALIFICATION_WORKFLOWS as WORKFLOWS } from "./qualification-workflows.mjs";
import { openContinuationLedger, verifyPredecessor } from "./continuation.mjs";
import { preflightCampaign } from "./preflight.mjs";
import { openCampaignLedger } from "./durable-budget.mjs";
import { createEvaluationClients } from "./clients.mjs";
import {
  buildEvaluationIndex,
  runTaskTrial,
  runWorkflowTrial,
  validateIndex
} from "./harness.mjs";
import { qualificationReport } from "./report.mjs";
import {
  FROZEN_V2,
  FROZEN_WORKFLOWS,
  FROZEN_V3,
  FROZEN_QUALIFICATION_WORKFLOWS
} from "./freeze.mjs";

export function sourceFingerprint(
  root = fileURLToPath(new URL("../../../", import.meta.url))
) {
  const paths = [];
  const visit = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          "node_modules",
          ".git",
          ".aicf",
          "_private",
          "private",
          "local",
          "scratch",
          "drafts",
          "archives",
          "backups",
          "dist",
          "dist-source",
          "generated-docs",
          "coverage",
          "tmp",
          "test-results"
        ].includes(item.name) ||
        item.name.startsWith(".")
      )
        continue;
      const target = path.join(directory, item.name);
      if (item.isDirectory()) visit(target);
      else if (/\.(?:ts|mjs|json|yaml|yml|md)$/.test(item.name))
        paths.push({
          path: path.relative(root, target).replaceAll("\\", "/"),
          contentHash: hashDiscoveryContent(readFileSync(target, "utf8"))
        });
    }
  };
  visit(root);
  return hashDiscoveryContent(
    paths.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  );
}

export function validateOffline() {
  const suite = loadSuite(),
    registry = registryFor(suite);
  if (
    fingerprintDiscoveryEvaluationSuite(suite) !== FROZEN_V3 ||
    hashDiscoveryContent(WORKFLOWS) !== FROZEN_QUALIFICATION_WORKFLOWS ||
    hashDiscoveryContent(DEVELOPMENT_WORKFLOWS) !== FROZEN_WORKFLOWS
  )
    throw new Error("Frozen evaluation material changed; use a new dataset version.");
  const oldV2 = JSON.parse(
    readFileSync(
      new URL("../discovery-fixtures/three-domains.v2.suite.json", import.meta.url),
      "utf8"
    )
  );
  if (fingerprintDiscoveryEvaluationSuite(oldV2) !== FROZEN_V2)
    throw new Error("Historical v2 suite changed.");
  const inventory = validateDataset(suite, WORKFLOWS);
  const checked = validatePublicFixtures([
    {
      kind: "discovery_eval_suite",
      fixture: suite,
      path: "synthetic/v2.suite.json",
      absolutePath: "/synthetic/v2.suite.json"
    }
  ]);
  if (!checked.valid)
    throw new Error("Evaluation suite schema or references are invalid.");
  // Validate structure/references through the public evaluator without buying retrieval or model work.
  const sample = JSON.parse(
    readFileSync(
      new URL("../discovery-fixtures/three-domains.suite.json", import.meta.url),
      "utf8"
    )
  );
  if (
    fingerprintDiscoveryEvaluationSuite(sample) !==
    "sha256:01d1ddfeb6c7768bf5108fc00917ce0a4d95283cfaf14dd5910adde2b55969d2"
  )
    throw new Error("Legacy suite changed.");
  const retained = (value) =>
    value.cases.filter((entry) => entry.partition !== "held_out");
  if (hashDiscoveryContent(retained(sample)) !== hashDiscoveryContent(retained(suite)))
    throw new Error("Unrecorded train/calibration request or label correction.");
  return {
    suite,
    registry,
    inventory,
    suiteFingerprint: FROZEN_V3,
    workflowsFingerprint: FROZEN_QUALIFICATION_WORKFLOWS
  };
}

export function readHostConfiguration(filename) {
  if (statSync(filename).size > 64_000)
    throw new Error("Host configuration exceeds its bound.");
  const config = JSON.parse(readFileSync(filename, "utf8"));
  const allowed = [
    "campaignId",
    "hostModule",
    "pricing",
    "tokenizerIdentity",
    "sdkVersion",
    "evidenceDirectory",
    "predecessor"
  ];
  if (
    !config ||
    Object.keys(config).some((key) => !allowed.includes(key)) ||
    !/^[a-zA-Z0-9_.-]{1,80}$/.test(config.campaignId) ||
    !["hostModule", "tokenizerIdentity", "sdkVersion"].every(
      (key) => typeof config[key] === "string" && config[key].trim()
    )
  )
    throw new Error(
      "Invalid host configuration; credentials must remain with the injected client."
    );
  const hostModule = path.resolve(path.dirname(filename), config.hostModule);
  return {
    ...config,
    hostModule,
    predecessor: config.predecessor
      ? {
          ...config.predecessor,
          directory: path.resolve(path.dirname(filename), config.predecessor.directory)
        }
      : undefined,
    hostModuleHash: hashDiscoveryContent(readFileSync(hostModule, "utf8"))
  };
}

/** No host module, SDK, credential or network is touched unless live execution is explicit. */
export async function runCampaign(options = {}) {
  const { suite, registry, inventory } = validateOffline();
  if (!options.live && !options.mockFactory && options.stage !== "report")
    return {
      status: "validated_offline",
      inventory,
      providerCalls: 0,
      suiteFingerprint: FROZEN_V3,
      workflowsFingerprint: FROZEN_QUALIFICATION_WORKFLOWS,
      schedule: {
        train: trialSchedule(suite, "train").length,
        baseline: trialSchedule(suite, "baseline").length,
        qualifyK8: trialSchedule(suite, "qualify", 8).length,
        workflows: WORKFLOWS.length * MODES.length
      }
    };
  const config = options.mockFactory
    ? {
        campaignId: options.campaignId ?? "mock-integration",
        hostModuleHash: "mock",
        sdkVersion: "deterministic-mock",
        tokenizerIdentity: "synthetic-token-count.v1",
        predecessor: options.predecessor
      }
    : readHostConfiguration(options.configFile);
  if (options.sourceFingerprint && !options.mockFactory)
    throw new Error("Live source bindings cannot be overridden.");
  const source = options.sourceFingerprint ?? sourceFingerprint();
  if (options.live) {
    const gatePath = path.resolve(
      ".aicf/discovery-implementation/phase-7a/offline-acceptance.json"
    );
    const gate =
      existsSync(gatePath) && statSync(gatePath).size <= 64_000
        ? JSON.parse(readFileSync(gatePath, "utf8"))
        : null;
    if (
      !gate ||
      gate.sourceFingerprint !== source ||
      gate.suiteFingerprint !== FROZEN_V3 ||
      gate.workflowsFingerprint !== FROZEN_QUALIFICATION_WORKFLOWS ||
      ![
        "build",
        "typecheck",
        "tests",
        "validate",
        "conformance",
        "package",
        "mockCampaign"
      ].every((key) => gate.checks?.[key] === true)
    )
      throw new Error(
        "Matching offline acceptance evidence is required before live execution."
      );
  }
  const binding = campaignBinding(suite, WORKFLOWS, source, {
    mock: !!options.mockFactory,
    model: EXECUTION.model,
    hostModuleHash: config.hostModuleHash,
    sdkVersion: config.sdkVersion,
    tokenizerIdentity: config.tokenizerIdentity,
    pricing: config.pricing
      ? Object.fromEntries(
          Object.entries(config.pricing).filter(([key]) => key !== "checkedAt")
        )
      : null
  });
  const directory =
    options.directory ??
    path.resolve(
      config.evidenceDirectory ?? `.aicf/discovery-evaluation/${config.campaignId}`
    );
  if (options.live && !config.predecessor)
    throw new Error("Live rerun requires the pinned original budget predecessor.");
  const prior = config.predecessor ? verifyPredecessor(config.predecessor) : null;
  const capacity = await preflightCampaign({
    suite,
    registry,
    workflows: WORKFLOWS,
    caps: { ...(prior?.remaining ?? CAPS), ...options.caps },
    pricing: config.pricing
  });
  if (!capacity.feasible)
    return {
      status: "incomplete",
      reasonCode: "schedule_capacity",
      capacity,
      providerCalls: 0
    };
  if (options.stage === "report" && !existsSync(path.join(directory, "journal.jsonl")))
    throw new Error("No matching campaign evidence exists to report.");
  const ledger = (config.predecessor ? openContinuationLedger : openCampaignLedger)({
    ...(config.predecessor ? { predecessor: config.predecessor } : {}),
    directory,
    binding,
    ...(options.caps ? { caps: options.caps } : {})
  });
  const loadCompleted = () =>
    ledger
      .records()
      .filter((event) => event.type === "trial.end")
      .map((event) => ledger.readArtifact(event.data.artifact));
  let host;
  try {
    if (!ledger.records().some((event) => event.type === "capacity.preflight"))
      ledger.record("capacity.preflight", capacity);
    const stage = options.stage ?? "all";
    if (stage === "report") {
      const choice = ledger
        .records()
        .find((event) => event.type === "profile.freeze")?.data;
      const values = loadCompleted();
      return qualificationReport(
        suite,
        registry,
        values.filter((value) => value.observation),
        values.filter((value) => value.workflowId),
        choice?.k ?? 8,
        ledger.snapshot()
      );
    }
    if (options.mockFactory) host = options.mockFactory({ ledger });
    else {
      const injected = await import(pathToFileURL(config.hostModule).href);
      const supplied = await injected.createHostInputs();
      if (
        supplied.tokenizerIdentity !== config.tokenizerIdentity ||
        supplied.sdkVersion !== config.sdkVersion
      )
        throw new Error("Host identity mismatch.");
      host = createEvaluationClients({
        ...supplied,
        pricing: config.pricing,
        ledger,
        mock: false
      });
    }
    if (
      host.mock !== !!options.mockFactory ||
      host.configuration.model !== EXECUTION.model ||
      host.embeddingConfiguration.model !== EXECUTION.embeddingModel ||
      host.embeddingConfiguration.dimensions !== 1536
    )
      throw new Error("Unexpected live model configuration.");
    let index;
    const indexEvent = ledger.records().find((event) => event.type === "index.ready");
    if (indexEvent) {
      const artifact = ledger.readArtifact(indexEvent.data.artifact),
        checked = validateIndex(artifact.index, registry, host);
      if (!checked.valid)
        throw new Error("Persisted index no longer matches the campaign.");
      index = checked.index;
    }
    if (stage === "index" || stage === "all") {
      if (!index) {
        const prior = ledger.beginTrial("administrative-index", {
          campaign: ledger.fingerprint,
          host: host.identity
        });
        if (prior.completed)
          throw new Error(
            "Completed index build requires its index publication record."
          );
        const built = await buildEvaluationIndex({ registry, host, ledger });
        ledger.finishTrial("administrative-index", built);
        if (built.status !== "built")
          return {
            status: "incomplete",
            reasonCode: "index_unavailable",
            ledger: ledger.snapshot()
          };
        index = built.index;
        ledger.record("index.ready", {
          artifact: ledger.writeArtifact("embedding-index.json", built)
        });
      }
      if (stage === "index")
        return {
          status: "index_built",
          indexFingerprint: index.indexFingerprint,
          ledger: ledger.snapshot()
        };
    }
    if (!index)
      throw new Error(
        "Build the compatible index explicitly before serving evaluation."
      );
    const runStage = async (current) => {
      const prerequisite = {
        baseline: "train",
        qualify: "baseline"
      }[current];
      if (
        prerequisite &&
        !ledger
          .records()
          .some(
            (event) =>
              event.type === "stage.complete" && event.data.stage === prerequisite
          )
      )
        throw new Error(
          "Complete the preceding campaign stage before purchasing this stage."
        );
      const choice = ledger
        .records()
        .find((event) => event.type === "profile.freeze")?.data;
      if (current === "qualify" && !choice)
        throw new Error("Freeze the calibrated configuration before qualification.");
      const schedule = trialSchedule(suite, current, choice?.k ?? 8);
      const scheduleHash = hashDiscoveryContent(schedule),
        prior = ledger
          .records()
          .find((event) => event.type === "schedule" && event.data.stage === current);
      if (prior && prior.data.hash !== scheduleHash)
        throw new Error("Qualification schedule changed.");
      if (!prior)
        ledger.record("schedule", {
          stage: current,
          hash: scheduleHash,
          count: schedule.length
        });
      for (const trial of schedule) {
        const priorTrial = ledger.beginTrial(trial.key, {
          trial,
          campaign: ledger.fingerprint,
          index: trial.mode.startsWith("hybrid") ? index.indexFingerprint : null
        });
        if (priorTrial.completed) {
          ledger.readArtifact(priorTrial.artifact);
          continue;
        }
        const value = await runTaskTrial({
          suite,
          registry,
          trial,
          host,
          ledger,
          index
        });
        ledger.finishTrial(trial.key, value);
        options.onProgress?.({
          stage: current,
          key: trial.key,
          completed: ledger.snapshot().completedTrials
        });
        if (
          ledger.snapshot().halted ||
          value.errors.some((code) =>
            ["accounting_unavailable", "budget_denied"].includes(code)
          )
        )
          return false;
      }
      if (
        !ledger
          .records()
          .some(
            (event) => event.type === "stage.complete" && event.data.stage === current
          )
      )
        ledger.record("stage.complete", {
          stage: current,
          hash: scheduleHash,
          count: schedule.length
        });
      return true;
    };
    for (const current of ["train", "baseline"]) {
      if (stage === current || stage === "all") {
        if (!(await runStage(current)))
          return {
            status: "incomplete",
            reasonCode: "budget_or_accounting",
            ledger: ledger.snapshot()
          };
        if (stage === current)
          return { status: "stage_completed", stage, ledger: ledger.snapshot() };
      }
    }
    if (stage === "freeze" || stage === "all") {
      if (
        !ledger
          .records()
          .some(
            (event) =>
              event.type === "stage.complete" && event.data.stage === "baseline"
          )
      )
        throw new Error("Complete calibration before freezing the profile.");
      if (!ledger.records().some((event) => event.type === "profile.freeze")) {
        const choice = {
          k: 8,
          frozen: true,
          reason: "Phase 7A fixes K=8; no K=4 calibration",
          baselineByMode: Object.fromEntries(
            MODES.map((mode) => [
              mode,
              hashDiscoveryContent(
                trialSchedule(suite, "baseline").filter((x) => x.mode === mode)
              )
            ])
          )
        };
        ledger.record("profile.freeze", choice);
      }
      if (stage === "freeze")
        return {
          status: "configuration_frozen",
          choice: ledger.records().find((event) => event.type === "profile.freeze").data
        };
    }
    if (stage === "qualify" || stage === "all")
      if (!(await runStage("qualify")))
        return {
          status: "incomplete",
          reasonCode: "budget_or_accounting",
          ledger: ledger.snapshot()
        };
    if (stage === "workflows" || stage === "all") {
      if (
        !ledger
          .records()
          .some(
            (event) => event.type === "stage.complete" && event.data.stage === "qualify"
          )
      )
        throw new Error("Complete qualification trials before workflow evaluation.");
      const choice = ledger
        .records()
        .find((event) => event.type === "profile.freeze")?.data;
      if (!choice) throw new Error("Freeze the profile before workflow evaluation.");
      for (const scenario of WORKFLOWS)
        for (const mode of MODES) {
          const key = `workflow.${scenario.id}.${mode.replace("/", ".")}`;
          const prior = ledger.beginTrial(key, {
            workflow: hashDiscoveryContent(scenario),
            mode,
            k: choice.k,
            campaign: ledger.fingerprint
          });
          if (prior.completed) {
            ledger.readArtifact(prior.artifact);
            continue;
          }
          ledger.finishTrial(
            key,
            await runWorkflowTrial({
              suite,
              registry,
              scenario,
              mode,
              k: choice.k,
              host,
              ledger,
              index
            })
          );
          if (
            ledger.snapshot().halted ||
            loadCompleted()
              .at(-1)
              ?.run?.usage.stages.some((item) =>
                ["budget_denied", "accounting_unavailable"].includes(item.reasonCode)
              )
          )
            return {
              status: "incomplete",
              reasonCode: "accounting",
              ledger: ledger.snapshot()
            };
        }
    }
    if (
      (stage === "workflows" || stage === "all") &&
      !ledger
        .records()
        .some(
          (event) => event.type === "stage.complete" && event.data.stage === "workflows"
        )
    )
      ledger.record("stage.complete", { stage: "workflows", count: 48 });
    const choice = ledger
        .records()
        .find((event) => event.type === "profile.freeze")?.data,
      values = loadCompleted();
    const report = qualificationReport(
      suite,
      registry,
      values.filter((value) => value.observation),
      values.filter((value) => value.workflowId),
      choice?.k ?? 8,
      ledger.snapshot()
    );
    return {
      status: options.mockFactory
        ? "mock_integration_completed"
        : report.complete
          ? "evaluation_completed"
          : "incomplete",
      report,
      campaignFingerprint: ledger.fingerprint,
      indexFingerprint: index.indexFingerprint
    };
  } finally {
    ledger.close();
  }
}

export async function campaignCli(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === "--live") options.live = true;
    else if (["--config", "--stage"].includes(item) && argv[i + 1])
      options[item === "--config" ? "configFile" : "stage"] = argv[++i];
    else
      throw new Error(
        "Use --config <host.json>, --stage <index|train|baseline|freeze|qualify|workflows|report|all>, and explicit --live."
      );
  }
  if (
    options.stage &&
    ![
      "index",
      "train",
      "baseline",
      "freeze",
      "qualify",
      "workflows",
      "report",
      "all"
    ].includes(options.stage)
  )
    throw new Error("Unknown campaign stage.");
  if (options.live && !options.configFile)
    throw new Error("Live evaluation requires an explicit host configuration.");
  return runCampaign(options);
}
