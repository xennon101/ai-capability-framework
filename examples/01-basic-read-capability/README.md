# 01 Basic Read Capability

Fake data: synthetic support tickets in `examples/support/`.

Goal: validate manifests and inspect the read capability
`support.ticket.get`.

Commands:

```bash
npm run build
node dist/cli.js validate examples
node dist/cli.js inspect examples
```

Expected output:

```text
Validated 16 manifest(s) and 18 fixture(s).
support.ticket.get
```

No secrets are required. No live provider calls run by default. This example
uses only public synthetic support data.
