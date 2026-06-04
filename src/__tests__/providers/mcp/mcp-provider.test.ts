import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  validatePublicFixtures,
  type LoadedCapabilityManifest,
  type ManifestRegistry
} from "../../../index.js";
import type { RuntimeCapabilitySlice } from "../../../runtime/index.js";
import {
  buildMcpProviderToolDescriptors,
  createMcpProviderToolCall,
  isMcpProviderToolDescriptor,
  loadMcpSdkModule,
  mcpAnnotationsForCapability,
  mcpSecuritySummaryForCapability,
  parseMcpProviderToolCall,
  toMcpProviderToolName
} from "../../../providers/mcp/index.js";

describe("MCP provider descriptors", () => {
  it("builds MCP descriptors for routed read and prepare capabilities", async () => {
    const registry = await loadExampleRegistry();
    const toolset = buildMcpProviderToolDescriptors({
      registry,
      slice: supportRuntimeSlice([
        "support.ticket.get",
        "support.refund.prepare_case",
        "support.refund.commit_case"
      ])
    });

    expect(toolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "capability_excluded",
      id: "support.refund.commit_case"
    }));
    expect(toolset.tools.map((tool) => tool.name)).toEqual([
      "aicf_support.ticket.get",
      "aicf_support.refund.prepare_case"
    ]);
    expect(toolset.tools.every(isMcpProviderToolDescriptor)).toBe(true);
    expect(toolset.toolNameMap.toProviderToolName("support.refund.commit_case")).toBeUndefined();

    const readTool = toolset.tools[0];
    expect(readTool).toMatchObject({
      _meta: {
        aicf: {
          approvalRequired: false,
          capabilityId: "support.ticket.get",
          lifecycleOperation: "read",
          riskTier: "low",
          security: {
            commitNotPerformed: true,
            requiresHostAuthorization: true,
            tenantScoped: true
          }
        }
      },
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true
      },
      inputSchema: {
        type: "object"
      },
      outputSchema: {
        type: "object"
      }
    });
    expect(readTool.description).toContain("Operation: read.");
    expect(readTool.description).toContain("does not commit side effects");

    const prepareTool = toolset.tools[1];
    expect(prepareTool._meta.aicf).toMatchObject({
      approvalRequired: true,
      capabilityId: "support.refund.prepare_case",
      lifecycleOperation: "prepare",
      sideEffects: {
        createsRecords: true,
        writesData: true
      }
    });
    expect(prepareTool.description).toContain("Operation: prepare.");
    expect(prepareTool.description).toContain("Approval may be required");
  });

  it("excludes restricted destructive capabilities by default", async () => {
    const registry = await loadExampleRegistry();
    const destructivePrepare = cloneCapability(registry, "support.refund.prepare_case", "support.refund.delete_preview", {
      side_effects: {
        ...mustCapability(registry, "support.refund.prepare_case").manifest.side_effects,
        deletes_records: true
      }
    });
    const destructiveRegistry = buildRegistry([
      mustCapability(registry, "scheduling.availability.get"),
      mustCapability(registry, "scheduling.invite.prepare"),
      destructivePrepare
    ]);
    const toolset = buildMcpProviderToolDescriptors({
      registry: destructiveRegistry,
      slice: supportRuntimeSlice([
        "scheduling.availability.get",
        "scheduling.invite.prepare",
        "support.refund.delete_preview"
      ])
    });

    expect(toolset.tools.map((tool) => tool.name)).toEqual([
      "aicf_scheduling.availability.get",
      "aicf_scheduling.invite.prepare"
    ]);
    expect(toolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.refund.delete_preview",
      reason: "restricted"
    }));
  });

  it("generates stable MCP-safe names and reports collisions", async () => {
    const registry = await loadExampleRegistry();
    const longName = toMcpProviderToolName("support.very.long.capability.identifier.with.many.segments.for.mcp.provider.bridge", {
      maxLength: 64
    });
    const first = cloneCapability(registry, "support.ticket.get", "support:ticket:get");
    const second = cloneCapability(registry, "support.ticket.get", "support/ticket/get");
    const collisionRegistry = buildRegistry([first, second]);
    const toolset = buildMcpProviderToolDescriptors({
      registry: collisionRegistry,
      slice: supportRuntimeSlice(["support:ticket:get", "support/ticket/get"])
    });

    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toMatch(/^aicf_support.very.long.capability.identifier.with.many._[a-f0-9]{8}$/);
    expect(toolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision",
      id: "support/ticket/get"
    }));
    expect(toolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support/ticket/get",
      reason: "tool_name_collision"
    }));
  });

  it("parses valid MCP tool calls and fails malformed or unknown calls safely", async () => {
    const registry = await loadExampleRegistry();
    const toolset = buildMcpProviderToolDescriptors({
      registry,
      slice: supportRuntimeSlice(["support.ticket.get"])
    });
    const parsed = parseMcpProviderToolCall(toolset, createMcpProviderToolCall({
      args: {
        ticket_id: "TCK-100"
      },
      name: "aicf_support.ticket.get"
    }));
    const malformed = parseMcpProviderToolCall(toolset, {
      params: {
        arguments: undefined,
        name: ""
      }
    });
    const unknown = parseMcpProviderToolCall(toolset, createMcpProviderToolCall({
      name: "aicf_unknown"
    }));

    expect(parsed).toMatchObject({
      parsed: {
        args: {
          ticket_id: "TCK-100"
        },
        capabilityId: "support.ticket.get",
        provider: "mcp"
      },
      valid: true
    });
    expect(malformed.valid).toBe(false);
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_call_parse_failed",
      path: "tools/call.params.name"
    }));
    expect(unknown.valid).toBe(false);
    expect(unknown.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_call_parse_failed"
    }));
  });

  it("exposes annotation/security helpers and optional SDK missing errors", async () => {
    const registry = await loadExampleRegistry();
    const readCapability = mustCapability(registry, "support.ticket.get");
    const commitCapability = mustCapability(registry, "support.refund.commit_case");

    expect(mcpAnnotationsForCapability(readCapability)).toMatchObject({
      readOnlyHint: true
    });
    expect(mcpAnnotationsForCapability(commitCapability)).toMatchObject({
      destructiveHint: true,
      openWorldHint: true
    });
    expect(mcpSecuritySummaryForCapability(readCapability)).toMatchObject({
      commitNotPerformed: true,
      requiresHostAuthorization: true,
      requiresUserContext: true,
      tenantScoped: true
    });
    await expect(loadMcpSdkModule({
      dependencyName: "@aicf/missing-mcp-sdk-test"
    })).rejects.toMatchObject({
      code: "provider_dependency_missing",
      provider: "mcp"
    });
  });

  it("keeps the MCP provider subpath isolated from root/runtime/OpenAI imports", async () => {
    const root = await import("../../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../../dist/runtime/index.js") as Record<string, unknown>;
    const openai = await import("../../../../dist/openai/index.js") as Record<string, unknown>;
    const mcp = await import("../../../../dist/providers/mcp/index.js") as Record<string, unknown>;

    expect(root.loadManifests).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(openai.runOpenAIResponses).toEqual(expect.any(Function));
    expect(mcp.buildMcpProviderToolDescriptors).toEqual(expect.any(Function));

    for (const file of [
      "dist/index.js",
      "dist/runtime/index.js",
      "dist/openai/index.js"
    ]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@modelcontextprotocol/sdk");
      expect(content).not.toContain("dist/providers/mcp/");
    }
  });
});

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const manifestValidation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);
  const errors = [
    ...loaded.errors,
    ...manifestValidation.errors,
    ...fixtureValidation.errors
  ];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  return buildRegistry(loaded.manifests);
}

function supportRuntimeSlice(capabilityIds: string[]): RuntimeCapabilitySlice {
  return {
    excluded: [],
    items: capabilityIds.map((capabilityId) => ({
      capabilityId,
      exposedOperations: ["select", capabilityId.includes("prepare") ? "prepare" : "select"].filter((operation, index, array) => array.indexOf(operation) === index) as Array<"select" | "prepare">,
      reasons: ["test slice"],
      score: 1
    })),
    warnings: []
  };
}

function mustCapability(registry: ManifestRegistry, capabilityId: string): LoadedCapabilityManifest {
  const capability = registry.capabilityById.get(capabilityId);
  if (!capability) {
    throw new Error(`Missing capability ${capabilityId}`);
  }
  return capability;
}

function cloneCapability(
  registry: ManifestRegistry,
  sourceCapabilityId: string,
  nextCapabilityId: string,
  overrides: Partial<LoadedCapabilityManifest["manifest"]> = {}
): LoadedCapabilityManifest {
  const source = mustCapability(registry, sourceCapabilityId);
  return {
    ...source,
    manifest: {
      ...JSON.parse(JSON.stringify(source.manifest)) as LoadedCapabilityManifest["manifest"],
      ...overrides,
      id: nextCapabilityId
    },
    path: `${nextCapabilityId}.yaml`
  };
}
