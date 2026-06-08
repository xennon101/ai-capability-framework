# Replay Simulation

Replay modes should avoid live calls by default:

- deterministic mock compares recorded safe snapshots.
- policy only reruns decisions.
- router only reruns selected slices.
- tool validation only reruns parsing and schema validation.

Live replay must require explicit opt-in and caller-provided provider code.
