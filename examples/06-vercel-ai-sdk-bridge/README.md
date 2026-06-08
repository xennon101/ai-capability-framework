# 06 Vercel AI SDK Bridge

Fake data: synthetic support manifests and mock `generateText`/`streamText`
functions.

Goal: build AICF-backed AI SDK tools while keeping AICF validation, policy,
lifecycle, and envelopes authoritative.

Command:

```bash
npm run test:ai-sdk:mock
```

Expected output:

```text
Test Files
passed
```

No secrets are required. No live provider calls run by default. Optional live
AI SDK use requires the host to supply a model configuration and explicit live
test environment.
