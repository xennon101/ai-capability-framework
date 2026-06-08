# Policy Broker Contract

The broker maps runtime context and a capability request to one of three outcomes:

- deny
- approval required
- allow

Inputs must include capability ID, operation, args when required, subject/account/tenant context, permissions, autonomy, and risk limits.

Policy hooks may add denials or approval requirements. They must not override core safety denials.
