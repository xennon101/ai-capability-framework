# Security Policy

AI Capability Framework is public. Please do not disclose secrets, customer
data, raw prompts, raw traces, provider payloads, internal endpoints, or private
documents in public issues, pull requests, or comments.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting if it is enabled for this repository.
If private reporting is unavailable, open a minimal public issue that describes
the affected area at a high level and asks for a private reporting path. Do not
include exploit details, credentials, real identifiers, or private data in that
public issue.

## What To Include Privately

- Affected schema, API, CLI command, or documentation area.
- Reproduction steps using synthetic data.
- Expected and actual behavior.
- Impact and suggested fix, if known.

## Public Safety

Security fixes should preserve the repository boundary:

- Keep `_private/` ignored and untracked.
- Redact or omit raw traces, prompts, and provider payloads.
- Use synthetic examples only.
- Run `npm run check` before handoff.
