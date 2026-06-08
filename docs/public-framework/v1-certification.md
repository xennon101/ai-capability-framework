# Final v1.0 Certification

This checklist defines when AICF can be called v1.0 complete. It is a release
readiness gate, not a compliance certification, audit opinion, legal opinion,
or security guarantee.

## Automated Gate

Run the final local gate:

```bash
npm run check:certification
```

The gate runs generated-type freshness, build, typecheck, repository lint,
tests, example validation, provider conformance, governance gate, docs build,
package checks, public artifact hygiene, runtime/optional/provider mock suites,
package dry-run, and final certification assertions.

Run the public-only safety gate when reviewing artifacts:

```bash
npm run check:public
```

`check:public` runs package public hygiene, workspace public hygiene, and
high-confidence secret scanning.

## Required Passing State

AICF is not v1.0 complete until:

- `npm run check:certification` passes locally.
- CI passes on a clean checkout.
- npm package dry-run contains only expected public files.
- clean consumer smoke test passes.
- docs build passes.
- all examples validate.
- no example requires real secrets by default.
- Live integration tests are opt-in and skipped by normal certification.
- provider conformance matrix passes for supported adapters.
- security pack generation works.
- trace-to-golden works.
- policy/action/audit stores have in-memory tests.
- control-plane reference UI/API has basic tests.
- AWS adapters have mocked tests and clear live-test instructions.
- public docs explain what AICF is and is not.
- public repository files are present.
- `SECURITY.md` exists and gives a private reporting path.
- `CHANGELOG.md` includes v1.0-ready release notes.

## Manual Review Checklist

Before a public v1.0 tag, manually inspect:

- npm package contents.
- README quickstart from a fresh machine or clean container.
- fresh-machine quickstart using the public npm package or a clean checkout.
- examples with fake data.
- generated API docs.
- governance/lifecycle docs.
- provider docs.
- security docs.
- no private docs or planning artifacts.
- no raw provider payloads.
- no secrets.
- no personal or private platform assumptions in docs.
- no hardcoded AWS account IDs or provider keys.
- no root import of optional dependencies.

## Source Archive Review

Source archive checks require a clean committed tree:

```bash
npm run archive:source
npm run check:source-archive
```

Do not zip the working directory manually. Workspace archives can include Git
metadata, dependencies, generated output, local logs, traces, prompts, provider
payloads, private notes, or packed artifacts.

## Live Tests

Live integration tests are opt-in. They require explicit environment variables
and are not part of normal v1.0 certification. Normal certification uses mock
clients, deterministic fixtures, descriptor exports, package dry-runs, and
public artifact checks.
