# Getting Started

AICF describes AI-facing application behavior as public, typed manifests.

Use it when you need to answer these questions:

- What can the model select?
- What input does the application accept?
- What output can the application return?
- What side effects can happen?
- Who is allowed to use the capability?
- What policy gates or approvals apply?
- What evals prove the behavior is stable?

## Basic Workflow

1. Identify one application behavior that the model may request.
2. Write a capability manifest for that behavior.
3. Define strict input and output JSON Schemas.
4. Mark side effects explicitly.
5. Add authorization and policy requirements.
6. Link synthetic eval cases that test selection, arguments, refusals, and
   approval boundaries.
7. Run `npm run validate`.

## Design Rules

- Give the model the smallest relevant set of capabilities for a task.
- Use deterministic application code for validation, permissions, policy,
  execution, and audit.
- Do not expose raw databases, unrestricted HTTP clients, shell access, payment
  tools, or admin tools directly to the model.
- Treat retrieved content and tool results as untrusted unless your application
  has explicitly marked them as authoritative.
- Keep examples synthetic and public-safe.

