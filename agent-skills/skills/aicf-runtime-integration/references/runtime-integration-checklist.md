# Runtime Integration Checklist

- App entrypoint and service boundary are identified.
- Auth, account, tenant, permissions, entitlements, and feature flags come from
  host-owned sources.
- Context builder labels untrusted input and redacts sensitive data.
- Router exposes only selected read/prepare capabilities.
- Handler registry maps capability IDs to app service functions.
- Policy broker fails closed for missing context or hook errors.
- Tests cover success, denial, invalid args, approval required, and handler failure.
