# Contributing

Thanks for improving AI Capability Framework. This repository is public, so
every tracked change must be safe to publish.

## Public-Safe Contributions

- Use synthetic examples with fake IDs, fake tenants, fake users, and
  `example.com` addresses.
- Do not commit credentials, account IDs, customer records, raw prompts, raw
  traces, provider payloads, private source documents, generated exports, or
  local experiments.
- Keep private notes and drafts in `_private/` or another ignored path.
- Never copy from `_private/` into tracked files verbatim. Distill public
  guidance in new wording.

## Development Workflow

Install dependencies:

```bash
npm ci
```

Common commands:

```bash
npm run generate:types
npm run check:generated
npm run build
npm test
npm run validate
npm run check:package
npm run check
```

Run `npm run generate:types` whenever schemas change. Generated public manifest
types under `src/generated/` must stay current.

## Pull Requests

Before opening a pull request:

- Run `npm run check`.
- Confirm examples are public-safe and synthetic.
- Confirm `_private/`, traces, prompts, provider payloads, generated local docs,
  packed tarballs, and local-only files are not tracked.
- Use `git status --short --ignored` to confirm private material remains
  ignored.
- Use `git ls-files` to inspect the tracked public surface.

## Scope

AICF 1.0 is a no-execution framework. Contributions should not add model calls,
handler registries, action stores, approval runtimes, or side effects unless a
future roadmap explicitly changes that boundary.
