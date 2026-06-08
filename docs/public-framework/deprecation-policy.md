# Deprecation Policy

Deprecated capabilities, APIs, docs, or commands should remain available long enough for
public users to migrate.

Deprecated public APIs and manifest fields should warn or remain documented for at least
one minor release before removal unless a security issue requires immediate denial.
Deprecated manifest fields must remain loadable until the next major version when
practical.

Deprecation guidance should include:

- replacement path;
- reason for change;
- expected removal window if known;
- migration notes;
- tests that preserve compatibility until removal.

Safety fixes may deny unsafe behavior immediately, but should still provide actionable
diagnostics.
