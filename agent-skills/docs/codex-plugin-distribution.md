# Codex Plugin Distribution

The Codex plugin manifest is `.codex-plugin/plugin.json`.

The manifest points to `./skills/`, uses relative asset paths, and omits legal
policy URLs unless the repository contains real public policy documents.

The package does not include MCP servers, hooks, app connectors, or cloud
deployment behavior. It distributes skill folders and public package metadata
only.

## Required Manifest Checks

- `skills` is exactly `./skills/`.
- `license` is `MIT`.
- `version` matches `agent-skills/package.json`.
- `interface.composerIcon` and `interface.logo` are relative asset paths that
  resolve inside the package.
- The manifest does not point to local-only files or dependency folders.

## Local Marketplace Example

Use a local marketplace entry while developing:

```json
{
  "name": "aicf-local-plugins",
  "plugins": [
    {
      "name": "aicf-agent-skills",
      "source": {
        "source": "local",
        "path": "./agent-skills"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

For public repository distribution:

```bash
codex plugin marketplace add xennon101/ai-capability-framework --sparse agent-skills
```

Run `npm run check:release` before sharing the plugin path.
