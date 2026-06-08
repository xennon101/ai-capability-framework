# Security Policy

AI Capability Framework is public. Please do not disclose secrets, customer
data, raw prompts, raw traces, provider payloads, internal endpoints, or private
documents in public issues, pull requests, comments, docs, or examples.

## Supported Versions

Security support is provided for the latest published `1.x` release candidate or
stable release on npm. Older prereleases may receive fixes when the maintainers
decide the fix is low-risk and useful for public migration.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting if it is enabled for this repository.
If private reporting is unavailable, open a minimal public issue that describes
the affected area at a high level and asks for a private reporting path. Do not
include exploit details, credentials, real identifiers, raw prompts, traces,
provider payloads, or private data in that public issue.

## What To Include Privately

- Affected version, commit, schema, API, CLI command, or documentation area.
- Reproduction steps using synthetic data.
- Expected and actual behavior.
- Impact and suggested fix, if known.

## Response Process

Maintainers will acknowledge valid private reports, assess severity and public
exposure, prepare a fix or mitigation, run release-readiness checks, and publish
advisory or release notes when appropriate. Reports that include unsafe public
details may be redacted or removed to protect users.

## High-Risk Areas

- Tool execution boundaries and model-exposed tool descriptors.
- Prompt injection and tool-result poisoning.
- Approval, idempotency, and commit lifecycle controls.
- Provider payload retention and trace redaction.
- MCP server integrations and caller-provided identity context.
- Host policy, auth, storage, and provider adapter hooks.

## Public Safety

Security fixes should preserve the repository boundary:

- Keep `_private/` ignored and untracked.
- Redact or omit raw traces, prompts, and provider payloads.
- Use synthetic examples only.
- Run `npm run check` before handoff.
