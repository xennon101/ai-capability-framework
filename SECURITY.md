# Security Policy

AI Capability Framework is public. Please do not disclose secrets, customer data, raw
prompts, raw traces, provider payloads, internal endpoints, or private documents in
public issues, pull requests, comments, docs, or examples.

## Supported Versions

Security support is provided for the latest published `1.x` release candidate or stable
release on npm. Older prereleases may receive fixes when the maintainers decide the fix
is low-risk and useful for public migration.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting if it is enabled for this repository. If
private reporting is unavailable, open a minimal public issue that describes the
affected area at a high level and asks for a private reporting path. Do not include
exploit details, credentials, real identifiers, raw prompts, traces, provider payloads,
or private data in that public issue.

## What To Include Privately

- Affected version, commit, schema, API, CLI command, or documentation area.
- Reproduction steps using synthetic data.
- Expected and actual behavior.
- Impact and suggested fix, if known.

## Response Process

Maintainers will acknowledge valid private reports, assess severity and public exposure,
prepare a fix or mitigation, run release-readiness checks, and publish advisory or
release notes when appropriate. Reports that include unsafe public details may be
redacted or removed to protect users.

## High-Risk Areas

- Tool execution boundaries and model-exposed tool descriptors.
- Prompt injection and tool-result poisoning.
- Approval, idempotency, and commit lifecycle controls.
- Provider payload retention and trace redaction.
- MCP server integrations and caller-provided identity context.
- Host policy, auth, storage, and provider adapter hooks.

## Dependency Security Updates

Version 1.1.1 raises the optional Zod minimum to 4.6.6 and updates the repository's
locked Zod to 4.6.7 and `fast-uri` to 3.1.9. Zod's collection-validation issue can
consume excessive memory; the `fast-uri` advisories concern URI normalization and
reference handling. See the
[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) and
[URI advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg).

Publishing a framework patch does not rewrite an application's existing lockfile. Update
and verify your application dependencies:

```sh
npm install ai-capability-framework@1.1.1
npm update fast-uri
npm ls fast-uri zod
npm audit --omit=dev
```

If your application already uses Zod, also update it:

```sh
npm install zod@^4.6.6
```

Then repeat the dependency listing, audit and application tests. `npm update fast-uri`
selects a compatible patched release within the installed dependency ranges; for the
framework's current Ajv resolution this is 3.1.9. Do not use a forced major upgrade or
assume a clean new installation repairs a different application's pinned dependency
tree. Lexical/native discovery needs neither Zod nor an optional provider SDK.

Maintain host request-size and collection limits. A patched validator does not turn an
unbounded application schema into a bounded one.

Dependabot monitors npm dependencies in both packages and proposes weekly version
updates on Monday at 05:00 Europe/London. Security alerts and security-update PRs
operate separately from that weekly schedule. Dependency PRs require review and passing
CI; they do not merge or publish automatically. The existing weekly audit remains
enabled.

## Public Safety

Security fixes should preserve the repository boundary:

- Keep `_private/` ignored and untracked.
- Redact or omit raw traces, prompts, and provider payloads.
- Use synthetic examples only.
- Run `npm run check` before handoff.
