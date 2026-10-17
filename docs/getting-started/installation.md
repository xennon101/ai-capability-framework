# Installation

Use Node.js 20, 22 or 24. Install the stable package in your application:

```sh
npm install ai-capability-framework
```

Version 1.1.0 includes the stable lexical/native search-to-tool workflow. The
[complete quickstart](provider-neutral-quickstart.md) runs with deterministic mocks,
without a provider SDK, API key, repository checkout or framework build.

Live calls require caller-supplied model access and explicit configuration. Optional
SDKs are installed only when your chosen provider integration needs them.

For reproducible deployments, pin the tested version in your lockfile. Existing
prereleases remain available by explicit version; `next` is a separate channel.

[Framework repository development](../development.md) has separate install/build/check
commands.
