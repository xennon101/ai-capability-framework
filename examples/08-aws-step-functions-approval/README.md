# 08 AWS Step Functions Approval

Fake data: synthetic approval payloads and fake AWS SDK clients.

Goal: inspect the optional AWS approval handoff and DynamoDB reference adapters
without credentials or network calls.

Command:

```bash
npm run test:aws
```

Expected output:

```text
Test Files
passed
```

No secrets are required. No live provider calls run by default. Optional live AWS
tests are skipped unless `RUN_AWS_INTEGRATION=1` and host-owned test resources
are configured.
