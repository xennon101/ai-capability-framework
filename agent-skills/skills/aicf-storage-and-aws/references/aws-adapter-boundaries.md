# AWS Adapter Boundaries

- AWS SDK imports belong only in AWS-specific modules.
- Constructor options should accept caller-provided clients.
- Normal tests use fake clients.
- Live integration tests require explicit opt-in.
- Root, runtime, provider, and skills package imports must not require AWS packages.
- Docs must distinguish reference adapters from deployed infrastructure.
