# 09 Security Packs And Promptfoo

Fake data: synthetic support and scheduling capabilities plus public security pack
templates.

Goal: generate public-safe security cases and API-key-free Promptfoo red-team
configuration.

Commands:

```bash
npm run test:security-packs
node dist/cli.js security list-packs
```

Expected output:

```text
approval_bypass
unsafe_commit_attempt
provider_payload_exposure
```

No secrets are required. No live provider calls run by default. AICF generates Promptfoo
config files; it does not run Promptfoo.
