# Release Checklist

This checklist prepares an AICF 1.0 release candidate for GitHub and public npm
distribution.

## Preflight

- Confirm the release branch contains only public framework material.
- Confirm `CHANGELOG.md` has the target release entry.
- Confirm README, start-here, OpenAI walkthrough, glossary, API docs, governance
  docs, audit docs, security docs, security-pack docs, memory docs, provenance
  docs, controls docs, spec docs, adapter docs, eval docs, and examples are
  internally consistent.
- Confirm `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `ROADMAP.md`, `docs/index.md`,
  grouped docs, and numbered examples are present and public-safe.
- Confirm `package.json` is not private and `publishConfig.access` is `public`.
- Confirm no private drafts, raw prompts, raw traces, provider payloads,
  credentials, generated local docs, or packed tarballs are tracked.

## Verification

Run:

```bash
npm ci
npm run generate:types
npm run check:generated
npm run build
npm run docs:api
npm run docs:build
npm test
npm run validate
node dist/cli.js gate examples --env production
npm run check:package
npm run check:package-public
npm run check:workspace-public
npm run check:release-install
npm run check
npm run check:runtime
npm run check:optional
npm run check:providers:mock
npm run check:release
npm run check:release:providers
npm run check:public
npm run check:certification
npm run test:anthropic:mock
npm run test:gemini:mock
npm run test:ai-sdk:mock
npm run test:langchain:mock
npm run test:mcp-provider
npm run test:mcp-server
npm run test:providers:conformance
npm run test:conformance
npm run test:semantic-kernel
npm run test:controls
npm run test:control-plane
npm run test:security-packs
npm run test:aws
npm run test:evalops
npm run test:memory
npm run test:evidence
npm run test:provenance
npm run check:providers:live # optional; requires provider-specific live env vars
npm test -- observability evals-live promptfoo langfuse evalops
npm test -- aws
npm test -- openai-agents
npm pack --dry-run --json
npm publish --dry-run --access public --tag next
npm pack
```

Then inspect:

```bash
git status --short --ignored
git ls-files
```

Private local draft directories, `dist/`, `node_modules/`, traces, prompts,
provider payloads, generated local docs, and local-only material must remain
untracked or ignored.

Confirm root and runtime imports remain provider-SDK-free, and confirm commit
capabilities are not exported by default from OpenAI, Anthropic, Gemini, AI SDK,
LangChain, MCP, or Semantic Kernel compatibility paths.

Final v1.0 certification is documented in
[Final v1 certification](public-framework/v1-certification.md). It includes a
fresh-machine quickstart review, examples with fake data, generated API docs,
governance/provider/security docs, no private artifacts, no raw payloads, no
secrets, no hardcoded cloud/provider IDs, and no root import of optional dependencies.

## Release Artifacts

Create source review archives with the checked source-archive script, not from
the working directory:

```bash
npm run archive:source
npm run check:source-archive
```

Do not zip the workspace directory. A workspace ZIP can accidentally include
`.git/`, `node_modules/`, private local draft directories, `dist/`, local logs,
prompts, traces, provider payloads, or packed artifacts.

Create the publishable npm artifact with:

```bash
npm pack --dry-run --json
npm pack
```

The npm package may include `dist/`, `schemas/`, `examples/`, `conformance/`,
`docs/`, README, license, changelog, contributing, code of conduct, governance,
roadmap, and security docs. It must not include private/local material,
source-only tests, scripts, generated TypeDoc output, raw prompts, raw traces,
provider request/response payloads, archives, or credentials.

The package should include the public `examples/runtime-support-billing/` mock
runtime flow and `docs/action-lifecycle.md` plus `docs/policy-broker.md`.
It should also include `examples/providers/` README examples,
`docs/start-here.md`, `docs/openai-walkthrough.md`, `docs/glossary.md`,
`docs/providers.md`, `docs/providers/conformance.md`, and
`docs/provider-conformance.md`.
It should also include `docs/governance/index.md`, `docs/audit/index.md`, the
governance schema subpaths under `schemas/governance/`, and the audit ledger
schema subpaths under `schemas/audit/`. It should also include
`docs/security/trust-taint-redaction.md` and schemas under `schemas/security/`.
Governed memory docs, schemas, built entrypoints, and public fixture should be
present at `docs/memory.md`, `schemas/memory/`, `dist/memory/`, and
`examples/support/memory/`.
Runtime control docs and schemas should be present at `docs/controls/index.md`
and `schemas/controls/`. Replay docs, schemas, and public-safe examples should
be present at `docs/evals/replay-and-trace-to-golden.md`, `schemas/replay/`,
and `examples/support/replay/`.
The self-hostable control-plane docs, built subpath, and local reference app
should be present at `docs/control-plane.md`, `dist/control-plane/`, and
`examples/control-plane/`.
Security-pack docs, schemas, and catalog files should be present at
`docs/security/security-packs.md`, `schemas/security-packs/`, and
`security-packs/`.
EvalOps docs, schemas, and built entrypoints should be present at
`docs/evalops.md`, `schemas/evalops/`, and `dist/evalops/`.
Evidence export docs, schemas, and built entrypoints should be present at
`docs/evidence.md`, `schemas/evidence/`, and `dist/evidence/`.
Content provenance docs, schemas, built entrypoints, and public-safe fixture
should be present at `docs/provenance.md`, `schemas/provenance/`,
`dist/provenance/`, and `examples/support/provenance/`.
Cross-provider conformance docs, schemas, and built entrypoints should be
present at `docs/providers/conformance.md`, `schemas/conformance/`,
`dist/conformance/`, and `dist/providers/conformance/`.
F15 docs and examples should be present at `docs/index.md`,
`docs/getting-started/`, `docs/core/`, `docs/runtime/`, `docs/providers/`,
`docs/security/`, `docs/evals/`, `docs/governance/`, `docs/observability/`,
`docs/aws/`, `docs/control-plane/`, `docs/public-framework/`, and
`examples/01-basic-read-capability/` through `examples/11-control-plane/`.

## CI And Release Workflows

- `.github/workflows/ci.yml` runs install, generated-type freshness, build,
  typecheck, repository lint, tests, validation, conformance, governance gate,
  package checks, and docs build.
- `.github/workflows/release-dry-run.yml` runs the full release gate, package
  dry-run, source archive creation/checking, final certification, and npm
  publish dry-run.
- `.github/workflows/security.yml` runs production dependency audit,
  high-confidence secret scanning, package public hygiene, and workspace public
  hygiene.
- `.github/workflows/docs.yml` runs TypeDoc generation and docs checks for docs
  and example changes.

## Trusted Publishing

Before relying on GitHub Actions publishing, configure the npm package trusted
publisher:

- Provider: GitHub Actions.
- Organization or user: `xennon101`.
- Repository: `ai-capability-framework`.
- Workflow filename: `publish.yml`.
- Allowed action: `npm publish`.

The workflow publishes only when a `v*` tag is pushed and only if the tagged
commit is already reachable from `origin/main`. Pre-release versions such as
`1.0.0-rc.1` publish with the `next` dist tag. Stable versions publish with the
`latest` dist tag.

## GitHub Release

- Use tag `v1.0.0-rc.1`.
- Use release title `AI Capability Framework v1.0.0-rc.1`.
- Summarize the framework as schemas, TypeScript core, CLI, deterministic
  decision APIs, OpenAI Responses adapter, eval runner, docs, and public
  examples, plus optional runtime, observability, live-eval, and self-hostable
  control-plane subpaths.
- Publish npm pre-release packages with a non-default dist tag such as `next`
  until the final 1.0.0 release is ready.
- Link to `CHANGELOG.md`, `docs/start-here.md`,
  `docs/openai-walkthrough.md`, `docs/glossary.md`, `docs/api.md`, `docs/spec.md`,
  `docs/control-plane.md`, `docs/openai-responses.md`,
  `docs/ai-sdk-runtime.md`, `docs/anthropic-runtime.md`,
  `docs/gemini-runtime.md`, `docs/langchain-runtime.md`,
  `docs/semantic-kernel-runtime.md`,
  `docs/openai-runtime.md`, `docs/observability-runtime.md`,
  `docs/live-evals.md`, `docs/aws-runtime.md`,
  `docs/aws/production-reference.md`, `docs/aws/dynamodb-single-table.md`,
  `docs/aws/step-functions-approval.md`, `docs/aws/cloudwatch-telemetry.md`,
  `docs/aws/kms-redaction.md`,
  `docs/mcp-server-runtime.md`, `docs/action-lifecycle.md`,
  `docs/policy-broker.md`, `docs/providers.md`,
  `docs/providers/conformance.md`, `docs/provider-conformance.md`,
  `docs/governance/index.md`, `docs/governance/gate.md`,
  `docs/audit/index.md`, `docs/security/trust-taint-redaction.md`,
  `docs/security/security-packs.md`,
  `docs/memory.md`,
  `docs/evidence.md`,
  `docs/provenance.md`,
  `docs/controls/index.md`,
  `docs/evalops.md`,
  `docs/eval-runner.md`,
  `docs/host-responsibilities.md`, `docs/interoperability.md`, and
  `docs/migration-0.1-to-1.0.md`.
- Include `examples/aws/README.md` as credential-free AWS wiring guidance.
- Mention that provider live tests are opt-in and normal release checks use
  mock clients, descriptor exports, and synthetic fixtures.
- Mention that `aicf gate examples --env production` is the deterministic
  governance gate for validation, coverage, conformance, and public artifact
  hygiene. It does not call models, execute provider SDKs, or expose commit
  capabilities to models.

## Post-Release

- Confirm GitHub Actions pass for the release commit or tag.
- Confirm the public repository file list does not expose private material.
- Confirm the npm package page shows the expected version, files, README, and
  license.
