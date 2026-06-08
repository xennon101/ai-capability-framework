# Live Provider Eval Guidance

Live-provider evals are optional and must be skipped unless explicit environment flags and caller-provided clients are present.

Keep live cases synthetic, small, and read/prepare only. Do not require live tests for normal package checks. Convert useful live findings into deterministic fixtures before relying on them for release gates.
