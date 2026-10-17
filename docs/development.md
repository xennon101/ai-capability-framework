# Repository development

Package users should start with the
[installed-package quickstart](getting-started/provider-neutral-quickstart.md). You do
not need a checkout, TypeScript compiler or provider SDK to run its mock flow.

For work on the framework itself, clone the public repository and run from its root:

```sh
npm ci
npm run check:generated
npm run build
npm run validate
```

Use `VITEST_MAX_WORKERS=2` when running `npm run check` or certification, as configured
in CI. Framework development checks are provider-free; live evaluation requires an
explicit opt-in and separate model access/budget. See [release checks](release.md).

The repository currently validates 16 manifests and 21 recognized fixtures. Additional
capabilities inside evaluation fixtures do not expand the normal manifest inventory.
Generated docs, tarballs and local evidence belong in ignored or temporary paths.
