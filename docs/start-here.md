# Start Here

Install with `npm install ai-capability-framework`, then follow the
[complete installed-package quickstart](getting-started/provider-neutral-quickstart.md).
It needs no checkout, provider SDK or API key.

You will author one capability, load its registry, create runtime context, register a
handler, search a task and execute the ordinary mock model/tool loop. The packaged
customer example then shows an authorized read followed by an approval-required preview.

Lexical/native is the recommended [stable workflow](api/stable-workflow.md). Dedicated
selection is optional; hybrid remains experimental with
[qualification limits](evals/discovery-qualification.md). Applications own
decomposition, dependencies, arguments, authentication, resource access and customer
responses.

- [Installation](getting-started/installation.md)
- [Capability manifests](capability-manifests.md)
- [Choose a runtime](providers/choose-a-runtime.md)
- [Discovery details](discovery.md)
- [API policy](api/public-api-policy.md)
- [Repository development](development.md)
