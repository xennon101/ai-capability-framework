# Agent Guide

This is a public repository. Treat every tracked file as publishable content for
the AI Capability Framework.

## Workspace Boundary

- Track only public framework material: `README.md`, `AGENTS.md`, `docs/`,
  `schemas/`, `examples/`, `scripts/`, package metadata, and other files that
  are intentionally written for a public audience.
- Keep private drafts, research notes, raw product specs, generated documents,
  transcripts, traces, prompts, local experiments, and user-specific material in
  `_private/` or another ignored path.
- Never move material from `_private/` into tracked paths by copying it verbatim.
  Distill it into new public text, remove private context, then validate it
  before staging.
- Before staging broad changes, run `git status --short --ignored` and confirm
  private files remain ignored.
- If a private file appears as tracked or staged, stop and fix the repository
  boundary before continuing.

## Public Content Rules

- Keep instructions practical and implementation-oriented.
- Avoid publishing credentials, endpoints, account IDs, tenant IDs, customer
  data, raw traces, raw prompts, provider payloads, internal project names, or
  unreleased planning material.
- Use generic examples with synthetic identifiers and `example.com` only.
- Prefer schemas, small examples, and validation scripts over long conceptual
  documents.
- For AI behavior changes, add or update example eval cases alongside schema or
  guidance changes.

## Engineering Workflow

- Preserve unrelated local changes. Do not reset, checkout, remove, or overwrite
  user work unless explicitly asked.
- Use `rg` for discovery and read nearby files before editing.
- Keep edits scoped to the framework contract, examples, or instructions touched
  by the request.
- Run `npm run validate` before handoff when schemas, examples, or validation
  scripts change.
- If new generated output, local data, or private drafts are created, add ignore
  rules before they can be staged.

## Repository Shape

- `schemas/` contains JSON Schema contracts for framework manifests.
- `examples/` contains synthetic public examples that validate against those
  schemas.
- `docs/` contains concise public guidance for using the framework.
- `_private/` is local-only preserved source material and must stay ignored.

