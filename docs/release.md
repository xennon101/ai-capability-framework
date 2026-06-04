# Release Checklist

This checklist prepares an AICF 1.0 release candidate for GitHub and public npm
distribution.

## Preflight

- Confirm the release branch contains only public framework material.
- Confirm `CHANGELOG.md` has the target release entry.
- Confirm README, API docs, spec docs, adapter docs, eval docs, and examples are
  internally consistent.
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
npm test
npm run validate
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
npm run test:anthropic:mock
npm run test:gemini:mock
npm run test:ai-sdk:mock
npm run test:langchain:mock
npm run test:mcp-provider
npm run test:mcp-server
npm run test:providers:conformance
npm run test:semantic-kernel
npm run check:providers:live # optional; requires provider-specific live env vars
npm test -- observability evals-live promptfoo langfuse
npm test -- aws
npm test -- openai-agents
npm pack --dry-run --json
npm pack
```

Then inspect:

```bash
git status --short --ignored
git ls-files
```

`_private/`, `dist/`, `node_modules/`, traces, prompts, provider payloads,
generated local docs, and local-only material must remain untracked or ignored.

Confirm root and runtime imports remain provider-SDK-free, and confirm commit
capabilities are not exported by default from OpenAI, Anthropic, Gemini, AI SDK,
LangChain, MCP, or Semantic Kernel compatibility paths.

## Release Artifacts

Create source review archives from Git, not from the working directory:

```bash
git archive --format=zip --output ai-framework-source.zip HEAD
```

Do not zip the workspace directory. A workspace ZIP can accidentally include
`.git/`, `node_modules/`, `_private/`, `dist/`, local logs, prompts, traces,
provider payloads, or packed artifacts.

Create the publishable npm artifact with:

```bash
npm pack
```

The npm package may include `dist/`, `schemas/`, `examples/`, `conformance/`,
`docs/`, README, license, changelog, contributing, and security docs. It must
not include private/local material, source-only tests, scripts, raw prompts,
raw traces, provider request/response payloads, archives, or credentials.

The package should include the public `examples/runtime-support-billing/` mock
runtime flow and `docs/action-lifecycle.md` plus `docs/policy-broker.md`.
It should also include `examples/providers/` README examples,
`docs/providers.md`, and `docs/provider-conformance.md`.

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
  control plane, OpenAI Responses adapter, eval runner, docs, and public
  examples, plus optional runtime observability and live-eval subpaths.
- Publish npm pre-release packages with a non-default dist tag such as `next`
  until the final 1.0.0 release is ready.
- Link to `CHANGELOG.md`, `docs/api.md`, `docs/spec.md`,
  `docs/control-plane.md`, `docs/openai-responses.md`,
  `docs/ai-sdk-runtime.md`, `docs/anthropic-runtime.md`,
  `docs/gemini-runtime.md`, `docs/langchain-runtime.md`,
  `docs/semantic-kernel-runtime.md`,
  `docs/openai-runtime.md`, `docs/observability-runtime.md`,
  `docs/live-evals.md`, `docs/aws-runtime.md`,
  `docs/mcp-server-runtime.md`, `docs/action-lifecycle.md`,
  `docs/policy-broker.md`, `docs/providers.md`,
  `docs/provider-conformance.md`, `docs/eval-runner.md`,
  `docs/host-responsibilities.md`, `docs/interoperability.md`, and
  `docs/migration-0.1-to-1.0.md`.
- Mention that provider live tests are opt-in and normal release checks use
  mock clients, descriptor exports, and synthetic fixtures.

## Post-Release

- Confirm GitHub Actions pass for the release commit or tag.
- Confirm the public repository file list does not expose private material.
- Confirm the npm package page shows the expected version, files, README, and
  license.
