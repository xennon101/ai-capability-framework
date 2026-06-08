# Skill Index

Generated from the current AICF Agent Skills package.

## aicf-action-lifecycle

- Description: Implement or audit AICF propose, prepare, preview, approve, commit, verify, audit, idempotency, and rollback-safe action workflows for side-effecting AI capabilities.
- Category: action-lifecycle
- Reference files: references/action-state-machine.md, references/approval-patterns.md, references/idempotency-and-audit.md, references/verification-patterns.md
- Primary trigger phrases: none
- Positive examples: Implement prepare, approval, commit, and verify for a side-effecting capability. | Audit duplicate commit prevention and action state transitions. | Add idempotency and audit tests for approval-required actions.
- Negative examples: Add a provider conformance export. | Create a quickstart README.

## aicf-capability-authoring

- Description: Author or modify AICF capability/entity manifests, schemas, model-facing slices, and starter evals. Use when creating an AI tool, exposing app functionality to models, or converting an operation into a governed AICF capability.
- Category: capability-authoring
- Reference files: references/checklist.md, references/examples.md, references/field-guide.md, references/manifest-decision-tree.md
- Primary trigger phrases: creating an AI tool, exposing app functionality to models, converting an operation into a governed AICF capability.
- Positive examples: Create an AICF manifest for a support ticket read tool. | Convert this refund operation into a governed AICF capability with an entity manifest. | Add starter evals for a new model-facing capability.
- Negative examples: Implement the HTTP handler for an existing capability. | Prepare the repository for an npm release.

## aicf-control-plane-ui

- Description: Build or audit the optional AICF governance control-plane UI/API for capability catalogue, lifecycle, policy decisions, approvals, eval status, traces, controls, and evidence export.
- Category: control-plane-ui
- Reference files: references/api-contracts.md, references/approval-console.md, references/control-plane-screens.md, references/operational-ux.md
- Primary trigger phrases: none
- Positive examples: Build the AICF control-plane capability catalogue and approval queue. | Audit control-plane API responses for safe summaries only. | Add tests for lifecycle, eval status, controls, and evidence export views.
- Negative examples: Convert a legacy tool into a capability manifest. | Validate Gemini function declarations.

## aicf-controls-and-budgets

- Description: Implement or audit AICF capability-level kill switches, circuit breakers, budgets, max loops, rate controls, and fail-safe read-only modes without replacing a model gateway.
- Category: controls-budgets
- Reference files: references/budget-policy.md, references/circuit-breakers.md, references/control-types.md
- Primary trigger phrases: none
- Positive examples: Add a capability kill switch and read-only mode. | Test budget exceeded behavior in the provider tool loop. | Audit circuit breakers for provider errors and validation failures.
- Negative examples: Add lifecycle approval records. | Prepare a source archive review.

## aicf-docs-and-examples

- Description: Update AICF public docs, quickstarts, examples, README files, API references, provider guides, and sample apps so they match current public contracts and implementation.
- Category: docs-examples
- Reference files: references/docs-style-guide.md, references/example-app-checklist.md, references/public-api-docs.md, references/quickstart-template.md
- Primary trigger phrases: none
- Positive examples: Update the README and quickstart after adding a provider subpath. | Refresh example app docs so commands and expected output match implementation. | Add a provider guide with mock-first usage and optional live steps.
- Negative examples: Implement a storage adapter. | Audit an approval state transition.

## aicf-eval-authoring

- Description: Create AICF capability-aware evals, golden tests, rubrics, deterministic fixtures, real-provider test cases, and regression suites. Use for AI quality, tool-choice accuracy, action correctness, or model upgrades.
- Category: evals
- Reference files: references/deterministic-scorers.md, references/eval-rubric.md, references/golden-test-patterns.md, references/real-provider-evals.md
- Primary trigger phrases: none
- Positive examples: Add golden evals for tool choice and input args. | Create deterministic fixtures for a model upgrade regression suite. | Write eval cases proving no forbidden commit tool is called.
- Negative examples: Configure a kill switch for a capability. | Review npm package contents.

## aicf-governance-lifecycle

- Description: Manage AICF capability lifecycle, risk compiler rules, compatibility checks, and impact analysis. Use when moving capabilities through draft, review, approved, canary, production, deprecated, disabled, or removed states.
- Category: governance
- Reference files: references/compatibility-checks.md, references/impact-analysis.md, references/lifecycle-state-machine.md, references/riskcompiler-rules.md
- Primary trigger phrases: moving capabilities through draft, review, approved, canary, production
- Positive examples: Review whether this capability can move from draft to production. | Run an impact analysis before deprecating a capability. | Compare two capability versions for governance risk.
- Negative examples: Write a new capability manifest from scratch. | Create trigger fixtures for the skills package.

## aicf-migration

- Description: Migrate existing AI tools, prompts, agents, raw function calls, RAG flows, or app integrations into AICF capabilities with policy, schemas, evals, runtime handlers, and safe rollout.
- Category: migration
- Reference files: references/conversion-playbook.md, references/legacy-tool-riskmap.md, references/migration-inventory.md, references/rollout-plan.md
- Primary trigger phrases: none
- Positive examples: Migrate our existing agent tools into AICF capabilities. | Inventory legacy function calls and convert them to governed manifests. | Plan a read-only canary rollout for a legacy RAG flow.
- Negative examples: Build the optional control-plane UI. | Prepare an npm package dry run.

## aicf-observability-replay

- Description: Add AICF tracing, OpenTelemetry-style events, Langfuse/export adapters, replay fixtures, simulation, and trace-to-golden workflows while keeping raw prompts and provider payloads redacted by default.
- Category: observability-replay
- Reference files: references/redacted-telemetry.md, references/replay-simulation.md, references/trace-span-map.md, references/trace-to-golden.md
- Primary trigger phrases: none
- Positive examples: Add AICF trace events for routing, policy, tools, and eval scores. | Create a replay fixture from sanitized runtime behavior. | Draft a trace-to-golden eval with review required.
- Negative examples: Wire host auth into the runtime context builder. | Create a red-team prompt injection case.

## aicf-policy-and-risk

- Description: Implement or audit AICF policy broker, risk tiers, semantic invariants, tenant isolation, permissions, entitlements, approval requirements, and fail-closed runtime decisions.
- Category: policy-risk
- Reference files: references/deny-approval-allow-matrix.md, references/policy-broker-contract.md, references/risktier-rules.md, references/semantic-invariants.md
- Primary trigger phrases: none
- Positive examples: Audit the policy broker for missing tenant checks. | Add fail-closed tests for approval-required prepare actions. | Review risk tiers and semantic invariants for a money movement capability.
- Negative examples: Generate a provider conformance matrix. | Create public release notes.

## aicf-provider-conformance

- Description: Validate AICF capabilities across provider and framework adapters: OpenAI, Anthropic Claude, Google Gemini, Vercel AI SDK, MCP, LangChain/LangGraph, and Semantic Kernel-compatible workflows.
- Category: provider-conformance
- Reference files: references/provider-normalization-matrix.md, references/provider-runtime-boundaries.md, references/schema-compatibility.md, references/tool-call-mapping.md
- Primary trigger phrases: none
- Positive examples: Validate tool descriptors across OpenAI, Anthropic, Gemini, MCP, and LangChain. | Run a provider conformance matrix for routed support capabilities. | Check schema normalization and tool-call parsing across provider adapters.
- Negative examples: Wire a handler registry into an API server. | Create public docs for a quickstart.

## aicf-release-hygiene

- Description: Prepare safe public AICF releases by checking package contents, source archives, npm dry runs, clean install, CI, docs, secrets, private artifacts, generated files, logs, traces, and provider payload leaks.
- Category: release-hygiene
- Reference files: references/forbidden-artifacts.md, references/package-smoke-test.md, references/release-checklist.md, references/source-archive-rules.md
- Primary trigger phrases: none
- Positive examples: Check package contents and clean install behavior before release. | Prepare a safe source archive review for the AICF package. | Run public release hygiene checks for docs, logs, traces, and generated files.
- Negative examples: Write policy broker reason-code tests. | Create a new capability manifest.

## aicf-runtime-integration

- Description: Integrate AICF runtime into an application by wiring context builders, capability routers, handler registries, policy brokers, provider runtimes, stores, and tests. Use when connecting AICF to real app code.
- Category: runtime
- Reference files: references/capability-router-patterns.md, references/context-builder-patterns.md, references/handler-registry-patterns.md, references/policy-broker-adapter.md, references/runtime-integration-checklist.md
- Primary trigger phrases: connecting AICF to real app code.
- Positive examples: Wire AICF runtime into this API server with context builders and handlers. | Connect the capability router and policy broker to real app services. | Add runtime tests for denied permission, malformed args, and approval required.
- Negative examples: Write only a capability manifest. | Prepare package contents for release.

## aicf-security-redteam

- Description: Generate AICF security and red-team tests for prompt injection, indirect injection, tool misuse, data exfiltration, cross-tenant access, approval bypass, schema confusion, and unsafe actions.
- Category: security-redteam
- Reference files: references/prompt-injection-patterns.md, references/redteam-acceptance.md, references/security-test-pack-map.md, references/tool-misuse-patterns.md
- Primary trigger phrases: none
- Positive examples: Generate red-team tests for approval bypass on a refund prepare capability. | Add prompt injection and schema confusion tests for a provider-exposed tool. | Create security cases for cross-tenant access and data exfiltration.
- Negative examples: Author a normal read capability manifest. | Update the plugin metadata version.

## aicf-skill-pack-maintenance

- Description: Create, update, validate, test, and release the AICF Agent Skills Pack itself, including SKILL.md frontmatter, trigger descriptions, references, assets, plugin metadata, and public distribution.
- Category: skill-pack-maintenance
- Reference files: references/overlap-prevention.md, references/plugin-packaging.md, references/skill-authoring-rules.md, references/trigger-evaluation.md
- Primary trigger phrases: none
- Positive examples: Add a new SKILL.md with references and trigger descriptions. | Update the AICF Agent Skills plugin metadata. | Regenerate the skill index and validate trigger fixtures.
- Negative examples: Promote a capability to production. | Create a red-team case for a high-risk tool.

## aicf-storage-and-aws

- Description: Implement optional AICF storage and AWS reference adapters for action stores, approval stores, audit, idempotency, Step Functions approvals, DynamoDB/RDS/Postgres, CloudWatch, and least-privilege IAM.
- Category: storage-aws
- Reference files: references/aws-adapter-boundaries.md, references/least-privilege-iam.md, references/step-functions-approval.md, references/store-interface-map.md
- Primary trigger phrases: none
- Positive examples: Add optional DynamoDB stores for AICF prepared actions and approvals. | Audit AWS adapter boundaries so root imports stay SDK-free. | Write fake-client tests for Step Functions approval handoff.
- Negative examples: Run a provider conformance matrix. | Create an eval case for tool selection.

## aicf-trust-redaction-retention

- Description: Add AICF trust labels, taint tracking, provenance, provider-boundary redaction, trace redaction, and retention rules. Use for privacy, prompt injection, sensitive data, or logging boundaries.
- Category: trust-redaction-retention
- Reference files: references/redaction-rules.md, references/retention-rules.md, references/taint-rules.md, references/trust-labels.md
- Primary trigger phrases: none
- Positive examples: Add trust labels and taint rules for retrieved document context. | Review provider-boundary redaction for sensitive support data. | Add retention rules for trace and eval artifacts.
- Negative examples: Implement a DynamoDB store. | Generate a skill index.

