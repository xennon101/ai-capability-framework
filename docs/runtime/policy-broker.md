# Policy Broker

The policy broker turns runtime context into AICF decisions. It wraps the Core
decision API and can call stricter host policy hooks.

Read the canonical guide:

- [Policy broker](../policy-broker.md)

Policy hooks may deny or require approval, but they cannot turn an AICF denial
into an allowed action.
