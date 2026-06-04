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
  AicfProviderError,
  toProviderToolName
} from "../../../providers/index.js";
import {
  exportSemanticKernelOpenApiPlugin,
  exportSemanticKernelPluginMetadata,
  getSemanticKernelMcpIntegrationGuide,
  isSemanticKernelOpenApiDocument,
  semanticKernelPathForToolName
} from "../../../providers/semantic-kernel/index.js";

describe("Semantic Kernel compatibility bridge", () => {
  it("exports OpenAPI 3.1 operations for selected read and prepare capabilities", async () => {
    const registry = await loadSupportRegistry();
    const exported = exportSemanticKernelOpenApiPlugin({
      registry,
      serverUrl: "https://aicf.example.com/runtime/",
      slice: supportRuntimeSlice([
        "support.ticket.get",
        "support.refund.prepare_case",
        "support.refund.commit_case"
      ]),
      title: "Synthetic Support AICF Plugin",
      version: "1.0.0-test"
    });

    expect(exported.diagnostics).toEqual([]);
    expect(isSemanticKernelOpenApiDocument(exported.document)).toBe(true);
    expect(exported.document).toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "Synthetic Support AICF Plugin",
        version: "1.0.0-test"
      },
      servers: [
        {
          url: "https://aicf.example.com/runtime"
        }
      ]
    });
    expect(Object.keys(exported.document.paths)).toEqual([
      semanticKernelPathForToolName("aicf_support_ticket_get"),
      semanticKernelPathForToolName("aicf_support_refund_prepare_case")
    ]);
    expect(exported.document.paths[semanticKernelPathForToolName("aicf_support_refund_commit_case")]).toBeUndefined();

    const readOperation = exported.document.paths[semanticKernelPathForToolName("aicf_support_ticket_get")]?.post;
    expect(readOperation).toMatchObject({
      operationId: "aicf_support_ticket_get",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              required: ["args", "runtime_context_ref"]
            }
          }
        },
        required: true
      },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AicfToolResultEnvelope"
              }
            }
          }
        }
      }
    });
    expect(readOperation?.requestBody.content["application/json"].schema.properties?.args).toMatchObject({
      properties: {
        ticket_id: {
          pattern: "^TCK-[0-9]+$",
          type: "string"
        }
      },
      type: "object"
    });
  });

  it("uses stable Semantic Kernel-safe operation IDs and reports collisions", async () => {
    const registry = await loadSupportRegistry();
    const longName = toProviderToolName("support.very.long.capability.identifier.with.many.segments.for.semantic.kernel.bridge", {
      provider: "semantic-kernel"
    });
    const first = cloneCapability(registry, "support.ticket.get", "support.ticket.get");
    const second = cloneCapability(registry, "support.ticket.get", "support-ticket-get");
    const collisionRegistry = buildRegistry([first, second]);
    const exported = exportSemanticKernelOpenApiPlugin({
      registry: collisionRegistry,
      serverUrl: "https://aicf.example.com",
      slice: supportRuntimeSlice(["support.ticket.get", "support-ticket-get"])
    });

    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toMatch(/^aicf_support_very_long_capability_identifier_with_many_[a-f0-9]{8}$/);
    expect(exported.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision",
      id: "support-ticket-get"
    }));
    expect(exported.document["x-aicf"].diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision"
    }));
    expect(Object.keys(exported.document.paths)).toEqual([
      semanticKernelPathForToolName("aicf_support_ticket_get")
    ]);
  });

  it("fails with a controlled provider error when serverUrl is invalid", async () => {
    const registry = await loadSupportRegistry();

    expect(() => exportSemanticKernelOpenApiPlugin({
      registry,
      serverUrl: "file:///tmp/aicf",
      slice: supportRuntimeSlice(["support.ticket.get"])
    })).toThrow(AicfProviderError);
    expect(() => exportSemanticKernelOpenApiPlugin({
      registry,
      serverUrl: "not a url",
      slice: supportRuntimeSlice(["support.ticket.get"])
    })).toThrow(/valid HTTP or HTTPS server URL/u);
  });

  it("includes AICF metadata without exposing auth or tenant schemas", async () => {
    const registry = await loadSupportRegistry();
    const exported = exportSemanticKernelOpenApiPlugin({
      registry,
      serverUrl: "https://aicf.example.com",
      slice: supportRuntimeSlice(["support.refund.prepare_case"])
    });
    const operation = exported.document.paths[semanticKernelPathForToolName("aicf_support_refund_prepare_case")]?.post;

    expect(operation?.["x-aicf"]).toMatchObject({
      approvalRequired: true,
      capabilityId: "support.refund.prepare_case",
      capabilityType: "write_prepare_only",
      lifecycleOperation: "prepare",
      riskTier: "medium",
      sideEffects: {
        createsRecords: true,
        refundsMoney: false,
        writesData: true
      }
    });
    const requestSchemaText = JSON.stringify(operation?.requestBody.content["application/json"].schema);
    expect(requestSchemaText).not.toContain("tenantId");
    expect(requestSchemaText).not.toContain("accountId");
    expect(requestSchemaText).not.toContain("permissions");
  });

  it("exports plugin metadata with MCP recommendation and OpenAPI import hints", async () => {
    const registry = await loadSupportRegistry();
    const metadata = exportSemanticKernelPluginMetadata({
      openApiDocumentUrl: "https://aicf.example.com/openapi.json",
      pluginName: "support_aicf",
      registry,
      serverUrl: "https://aicf.example.com",
      slice: supportRuntimeSlice([
        "support.ticket.get",
        "support.refund.prepare_case",
        "support.refund.commit_case"
      ])
    });

    expect(metadata).toMatchObject({
      mcp: {
        recommended: true
      },
      openapi: {
        documentUrl: "https://aicf.example.com/openapi.json",
        serverUrl: "https://aicf.example.com"
      },
      pluginName: "support_aicf",
      provider: "semantic-kernel"
    });
    expect(metadata.functions.map((item) => item.capabilityId)).toEqual([
      "support.ticket.get",
      "support.refund.prepare_case"
    ]);
    expect(metadata.functions[1]).toMatchObject({
      approvalRequired: true,
      lifecycleOperation: "prepare",
      riskTier: "medium"
    });
  });

  it("documents MCP safety guidance for Semantic Kernel hosts", () => {
    const guide = getSemanticKernelMcpIntegrationGuide();

    expect(guide).toContain("selected capability slice");
    expect(guide).toContain("Commit capabilities must not be listed");
    expect(guide).toContain("auth, account and tenant authority");
    expect(guide).toContain("Approval-required AICF envelopes are pauses");
    expect(guide).toContain("automatic function invocation");
  });

  it("keeps Semantic Kernel compatibility isolated to its provider subpath", async () => {
    const root = await import("../../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../../dist/runtime/index.js") as Record<string, unknown>;
    const providers = await import("../../../../dist/providers/index.js") as Record<string, unknown>;
    const mcpServer = await import("../../../../dist/mcp-server/index.js") as Record<string, unknown>;
    const semanticKernel = await import("../../../../dist/providers/semantic-kernel/index.js") as Record<string, unknown>;

    expect(root.loadManifests).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(providers.createProviderToolNameMap).toEqual(expect.any(Function));
    expect(mcpServer.AicfMcpServer).toEqual(expect.any(Function));
    expect(semanticKernel.exportSemanticKernelOpenApiPlugin).toEqual(expect.any(Function));

    for (const file of [
      "dist/index.js",
      "dist/runtime/index.js",
      "dist/providers/index.js",
      "dist/mcp-server/index.js"
    ]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("from \"semantic-kernel\"");
      expect(content).not.toContain("from 'semantic-kernel'");
      expect(content).not.toContain("@semantic-kernel");
    }
  });
});

async function loadSupportRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples/support" });
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
