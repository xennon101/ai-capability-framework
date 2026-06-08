# 03 Multi-Provider Tools

Fake data: synthetic support and scheduling manifests in `examples/`.

Goal: export the same routed capability slice as provider tool descriptors.

Commands:

```bash
npm run build
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js anthropic-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js gemini-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js providers export-tools examples --provider mcp --context examples/support/openai/context.support_agent.json
```

Expected output:

```text
"support.refund.prepare_case"
"support.ticket.get"
"excluded"
```

No secrets are required. No live provider calls run by default. The commands only export
descriptors and binding maps.
