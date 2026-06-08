# 07 Policy Broker With Custom Auth

Fake data: synthetic support permissions and runtime context.

Goal: see how host auth and account systems can make AICF decisions stricter
without replacing AICF validation.

Commands:

```bash
npm run test:governance
npm test -- runtime
```

Expected output:

```text
missing permission
denied
passed
```

No secrets are required. No live provider calls run by default. Production auth,
tenant boundaries, account state, and entitlements remain host responsibilities.
