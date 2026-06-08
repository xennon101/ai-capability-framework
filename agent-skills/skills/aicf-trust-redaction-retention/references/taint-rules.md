# Taint Rules

- User text, retrieved content, external content, tool results, and model output are tainted data by default.
- Taint is preserved when content is summarized.
- Taint can be cleared only when host validation maps content to a typed AICF request, result, or trusted app record.
- Tainted content may influence data fields but must not alter hidden instructions or policy.
