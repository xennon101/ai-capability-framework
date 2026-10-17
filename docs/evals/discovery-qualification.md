# Discovery qualification for 1.1.0-rc.1

Stable 1.1.0 reuses these frozen observations without new live trials or retrieval
changes. The [named lexical/native workflow](../api/stable-workflow.md) now has a stable
compatibility commitment; the historical prerelease classification below describes the
assessed release. Hybrid qualification is unchanged.

Lexical retrieval with ordinary model tool selection (**lexical/native**) is the
recommended default. Lexical/dedicated also qualified for the tested configuration; it
remains an optional additional model call. Hybrid/native and hybrid/dedicated remain
**experimental and opt-in** because they did not meet the incremental-gain gate.
Discovery's API classification remains **release-candidate public**.

These results qualify a configuration on an authored synthetic dataset. They do not
establish general production quality, guarantee the first candidate, or authorize an
action. Applications still own intent decomposition, dependencies, arguments and
customer responses. Evaluate your own capability corpus and traffic before adoption.

## Tested configuration and assessment history

The campaign used suite v3: 240 cases across support, inventory and scheduling, with 80
per domain and 120/60/60 train/calibration/held-out cases. There are 60 scenario
families overall and 15 held-out families. Related paraphrases share a partition. The
fresh held-out families were withheld from calibration; this is not an external blind
benchmark, and published fixtures are now exposed regression material.

The frozen configuration used eight candidates; gpt-6-luna with reasoning effort none
for planning, selection and ordinary turns; text-embedding-3-small at 1,536 dimensions;
hybrid weights 0.75 semantic/0.25 lexical; and unavailable on hybrid failure. These are
campaign settings, not framework model defaults. Model access, explicit indexes and
finite budgets remain caller-owned. Returned generation model identities matched the
requested alias; an immutable model snapshot was not available.

The full 240-case pass and three 60-case held-out passes were assessed independently,
including each mode's declared calibration baseline and critical cohorts. Ready-task p95
had to be at most 15 seconds, with a 30-second absolute deadline. Quality thresholds
were 95% recall and selected-candidate accuracy, 90% coverage, at most 1% false
selection on true no-match cases, and zero safety violations. Critical-cohort
regressions greater than five percentage points failed the gate. No pooled average
replaced a failed pass.

The original workflow assessment was **40/48**, with all four modes unqualified. A
separately versioned offline wording-checker correction reassessed the same saved
evidence as **48/48**, or **12/12 per mode**. Seven date-rendering assessments and one
negated-completion assessment changed. This was not a fresh live trial or a model
improvement. The eight actual deterministic fallback responses, tool receipts,
operational failures, original grades and accounting remain unchanged. The earlier,
different campaign's 22/48 result was not regraded.

## Full-suite results

Accuracy is measured on selected answerable matched cases. Coverage retains missed and
failed decisions in its denominator. Recall uses the suite's answerable cases. The
remaining cases include true no-match and eligibility-exclusion scenarios.

| Mode              | Compatible recall at 8 | Selected accuracy | Selection coverage | Ready-task p95 | Revised overall               |
| ----------------- | ---------------------- | ----------------- | ------------------ | -------------- | ----------------------------- |
| lexical/native    | 118/120                | 118/118           | 118/120            | 4.14 s         | Qualified                     |
| lexical/dedicated | 118/120                | 118/118           | 118/120            | 6.15 s         | Qualified                     |
| hybrid/native     | 120/120                | 120/120           | 120/120            | 4.42 s         | Unqualified: incremental gain |
| hybrid/dedicated  | 120/120                | 117/117           | 117/120            | 5.98 s         | Unqualified: incremental gain |

Case-level descriptive 95% Wilson intervals are below. Paraphrases within families are
correlated; these are not family-independent uncertainty estimates or guarantees.

| Mode              | Recall interval | Accuracy interval | Coverage interval |
| ----------------- | --------------- | ----------------- | ----------------- |
| lexical/native    | 94.13–99.54%    | 96.85–100.00%     | 94.13–99.54%      |
| lexical/dedicated | 94.13–99.54%    | 96.85–100.00%     | 94.13–99.54%      |
| hybrid/native     | 96.90–100.00%   | 96.90–100.00%     | 96.90–100.00%     |
| hybrid/dedicated  | 96.90–100.00%   | 96.82–100.00%     | 92.91–99.15%      |

Every mode made **0/48 false selections** on full-suite true no-match cases (95% Wilson
interval 0–7.41%). Permission/lifecycle violations, policy-forbidden export, forbidden
choices, read-to-mutation selections and commit exposure/execution were zero. An
eligible competing read/prepare candidate in a shortlist is not an execution violation.

Retrieval alone still produced candidates for **47/48 lexical** and **48/48 hybrid**
true no-match cases. Models abstained or otherwise safely declined these requests. This
high retrieval false-positive rate is a practical reason to retain ordinary model
selection and clarification rather than automatically execute the highest-scoring tool.

Full-suite selection outcomes were 118 selected/49 abstained/73 unperformed for each
lexical mode; 120/48/72 for hybrid/native; and 117 selected/48 abstained/3 invalid
outputs/72 unperformed for hybrid/dedicated. Unperformed means no model decision was
requested; it is not fabricated abstention.

## Held-out repetitions and workflows

Each held-out pass had 60 cases, 15 families, 24 answerable cases and 12 true no-match
cases. Recall was **24/24** for every mode in every pass. Columns show passes 1, 2 and 3
in order. Consistency counts identical outcome/choice across repetitions, including
non-answerable cases; it is reported separately from gate results.

| Mode              | Coverage by pass    | Selected accuracy by pass | p95 seconds by pass | Consistent cases |
| ----------------- | ------------------- | ------------------------- | ------------------- | ---------------- |
| lexical/native    | 24/24; 24/24; 24/24 | 24/24; 24/24; 24/24       | 3.66; 3.64; 3.85    | 57/60            |
| lexical/dedicated | 24/24; 24/24; 24/24 | 24/24; 24/24; 24/24       | 5.56; 6.22; 5.89    | 59/60            |
| hybrid/native     | 24/24; 24/24; 24/24 | 24/24; 24/24; 24/24       | 4.70; 3.94; 4.25    | 59/60            |
| hybrid/dedicated  | 23/24; 24/24; 23/24 | 23/23; 24/24; 23/23       | 6.39; 5.41; 6.02    | 58/60            |

For 24/24, the 95% Wilson interval is 86.20–100%; for 23/24, 79.76–99.26%; and for
23/23, 85.69–100%. False selection was 0/12 in every pass (interval 0–24.25%). All
critical-cohort comparisons and ready-task latency gates passed independently.

Hybrid/dedicated retained four invalid selector outputs: three in the full pass and one
in held-out pass 1. A separate unavailable selector decision in held-out pass 3 also
remains a failure in coverage. Neither outcome was replaced by a successful rerun.

All modes passed the revised 12-workflow assessment. Across the 48 workflows, the
application performed 24 authorized reads and 12 approval-required preparations, with no
commit exposure. Application delivery was already 48/48 using eight observed fallbacks;
the offline correction changed wording-dependent grading only.

## Why hybrid is not promoted

Promotion required at least two percentage points higher compatible recall, or at least
20% lower model-input tokens at unchanged recall, against lexical retrieval with the
same candidate limit and selection mechanism. The observed recall increase was **1.67
percentage points** (120/120 versus 118/120).

| Mode              | Full-pass model-input tokens |
| ----------------- | ---------------------------- |
| lexical/native    | 619,786                      |
| lexical/dedicated | 445,346                      |
| hybrid/native     | 715,689                      |
| hybrid/dedicated  | 466,759                      |

These model-input counts exclude query-embedding tokens. Hybrid increased model input
instead of achieving the required reduction. Both hybrid modes therefore remain
unqualified overall despite passing their matching, workflow and safety gates. No
ranking weights, thresholds, aliases or labels were tuned to turn this into a pass.

The current campaign recorded 3,097 generation/embedding attempts and 5,521 HTTP
requests including token preflights; reported input/output tokens were 3,889,390/108,203
with complete current-campaign usage. Earlier campaign evidence retains an unknown-usage
provider failure and conservative charging. Stage receipts are not added again to
overlapping run/campaign totals. Offline regrading and release verification purchase
zero additional model calls.

## Evidence bindings and reproduction

The live transport receipts and original model wording remain private. The following
safe bindings identify the frozen inputs and derived assessment:

- Suite v3: `sha256:5e5f0cb1a848b733174e6e2e444e7c3bd8a90680fcd6009c7323d635c3605f69`.
- Qualification workflows:
  `sha256:8fabf71450f0d3b04a9d4b543d844bc94b0e70e20c698897db127a7d516cff61`.
- Campaign: `sha256:187b918cea5aecc0ab4075f2770310a0eddc314bf02d5d147008db773e5b6b76`.
- Original report bytes:
  `sha256:052d0e1abb1d39f527cf0258510058ebd3bc4ef07ff557761df4d447c6ef607e`.
- Revised report:
  `sha256:f354d381035f6b28b21c3812d45ac69e14e5577c980f93dc53ba7b7a57d89def`.

The correction uses synthetic-wording.v2 and workflow-wording-regrade.v1. See the
[evaluation and offline-regrade commands](discovery-live.md) for reproducible
provider-free checks and explicit, separately budgeted live execution. No-key examples
validate integration contracts; they do not recreate these live observations.
