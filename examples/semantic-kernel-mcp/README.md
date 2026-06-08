# Semantic Kernel MCP Example

This example describes the recommended Semantic Kernel integration path for AICF: import
an AICF MCP server as a Semantic Kernel MCP plugin.

The grouped provider example is available at `examples/providers/semantic-kernel-mcp/`.

The host application should:

1. Load and validate AICF manifests.
2. Build runtime context from trusted host auth, account, tenant, permissions, workflow,
   autonomy, and risk inputs.
3. Route a selected capability slice with `DefaultCapabilityRouter`.
4. Expose that slice through `AicfMcpServer`.
5. Import the MCP server into Semantic Kernel.

The MCP server lists and executes read/prepare capabilities only. Commit capabilities
are not listed and are not executable through model tool calls. Approval-required
envelopes are pauses; the host must collect and verify approval before committing
through the AICF action lifecycle manager.

This directory is documentation-only and contains no credentials, provider payloads,
traces, or real customer data.
