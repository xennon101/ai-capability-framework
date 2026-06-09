---
name: aicf-storage-and-aws
description:
  Implement optional AICF storage and AWS reference adapters for action stores, approval
  stores, audit, idempotency, Step Functions approvals, DynamoDB/RDS/Postgres,
  CloudWatch, and least-privilege IAM.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF. AWS work must remain optional and subpath-isolated.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "storage-aws"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Storage And AWS

## Purpose

Guide optional storage and AWS reference adapter work while keeping cloud dependencies
isolated, tests local by default, and host deployment authority explicit.

## Use this skill when

- Implementing or auditing AICF stores for actions, approvals, audit, idempotency,
  controls, replay metadata, or control-plane state.
- Adding optional AWS reference adapters for DynamoDB, Step Functions, EventBridge,
  CloudWatch, KMS, RDS, Aurora, or Postgres.
- Writing fake-client tests or least-privilege IAM examples.

## Do not use this skill when

- Adding root/runtime AWS imports.
- Deploying cloud resources automatically.
- Running live AWS tests by default.
- Building production auth, approval UI, or workflow definitions.

## Inputs to inspect first

- AWS subpath exports, runtime store interfaces, audit/controls/control-plane contracts,
  existing fake clients, docs, and package import tests.
- References: [adapter boundaries](references/aws-adapter-boundaries.md),
  [store map](references/store-interface-map.md),
  [Step Functions approval](references/step-functions-approval.md), and
  [least privilege IAM](references/least-privilege-iam.md).

## Workflow

1. Confirm storage or AWS support is optional and subpath isolated.
2. Map AICF public interfaces to durable store operations.
3. Store only redacted refs, hashes, statuses, summaries, reasons, and safe metadata.
4. Add fake-client tests for command shapes and undefined value rejection.
5. Gate live integration tests behind explicit environment flags.
6. Add least-privilege IAM examples without credentials or account-specific IDs.
7. Confirm root, runtime, provider, and skills imports do not require AWS SDK packages.

Use [DynamoDB template](assets/dynamodb-store.template.ts),
[Postgres template](assets/postgres-store.template.ts), and
[Step Functions template](assets/step-functions-approval.template.ts) as safe examples.

## Required outputs

- Optional storage or AWS adapter implementation/audit notes.
- Fake-client tests and package import boundary tests.
- Public-safe docs or examples for host responsibilities.

## Validation

- Run targeted AWS/storage tests, package checks, and root import-boundary tests.
- Confirm no network call or cloud mutation happens in normal tests.
- Confirm stored records omit private identifiers and sensitive tool output.

## Hard rules

- Do not make AWS required outside the AWS subpath.
- Do not commit credentials, account-specific IDs, generated logs, or local state.
- Do not add infrastructure provisioning that mutates resources by default.
- Do not expose commit capabilities to models through storage work.

## Handoff format

Report interfaces implemented, adapter isolation, tests run, safe payload behavior, and
any host deployment/IAM obligations.
