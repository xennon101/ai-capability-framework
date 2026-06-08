# API Contracts

Control-plane APIs should return JSON-serializable safe responses:

- status.
- IDs or redacted refs.
- summaries.
- counts.
- reason codes.
- coverage metadata.
- safe errors.

Do not return raw transcripts, provider transport details, stack traces, secrets, or unredacted tenant/account/user IDs.
