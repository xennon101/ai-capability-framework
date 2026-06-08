# Schema Compatibility

Provider schema exports may use provider-compatible subsets, but AICF input schemas
remain canonical for validation.

Reject or diagnose non-object roots, unsupported composition, ambiguous nullable
handling, and provider features that would weaken validation. Clone schemas before
normalization.
