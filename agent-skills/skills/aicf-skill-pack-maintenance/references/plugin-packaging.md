# Plugin Packaging

The plugin manifest points at the package `skills/` directory. Package dry-run should include skill folders, plugin metadata, scripts, docs, assets, README, license, and changelog.

Install scripts should copy only skill folders. They must not copy package metadata, tests, dependency folders, plugin metadata, or local generated artifacts.
