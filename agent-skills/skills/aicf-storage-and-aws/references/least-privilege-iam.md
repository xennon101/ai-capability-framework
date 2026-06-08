# Least Privilege IAM

IAM examples should be snippets, not deployable secrets.

Recommended guidance:

- grant table read/write only for required entity keys.
- grant Step Functions actions only for the configured state machine.
- grant EventBridge or CloudWatch actions only for required resources.
- include cleanup and rotation notes.
- use synthetic resource names and `example.com` where needed.
