# Trigger Evaluation

Each real skill needs trigger fixture coverage:

- `positive`: prompts that should select the skill.
- `negative`: prompts that should not select the skill.
- `required_description_terms`: words or phrases that must appear in the description.

Trigger fixtures are static coverage examples, not live model-selection tests.
