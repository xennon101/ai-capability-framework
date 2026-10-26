import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AicfMcpServer, registerAicfMcpTools } from "ai-capability-framework/mcp-server";
import { DefaultCapabilityRouter, DefaultContextBuilder } from "ai-capability-framework/runtime";

export async function verifyMcpSdkConsumer() {
  const packageDirectory = path.dirname(fileURLToPath(import.meta.resolve("ai-capability-framework/package.json")));
  const { createCustomerHarness } = await import(pathToFileURL(path.join(packageDirectory,
    "examples/12-capability-discovery-selection/customer-harness.mjs")).href);
  const harness = await createCustomerHarness();
  const aicf = new AicfMcpServer({
    registry: harness.registry, executor: harness.executor, contextBuilder: new DefaultContextBuilder(),
    router: new DefaultCapabilityRouter(), runtimeContextFactory: () => harness.runtimeContext
  });
  const request = { userInput: "Read ticket TCK-100 and prepare a refund for its order." };
  const sdk = new McpServer({ name: "synthetic-security-check", version: "1.0.0" });
  const client = new Client({ name: "synthetic-security-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    const registered = await registerAicfMcpTools({ aicfServer: aicf, mcpServer: sdk, request });
    assert(registered.registered > 0);
    await sdk.connect(serverTransport);
    await client.connect(clientTransport);
    const list = await client.listTools();
    assert(list.tools.every(tool => !tool.name.includes("commit")));
    const read = list.tools.find(tool => tool.name.includes("support.ticket.get"));
    const prepare = list.tools.find(tool => tool.name.includes("support.refund.prepare_case"));
    assert(read && prepare);
    const invalid = await client.callTool({ name: read.name, arguments: { ticket_id: 42 } });
    assert.equal(invalid.isError, true);
    assert.equal(harness.readCalls.length, 0);
    const result = await client.callTool({ name: read.name, arguments: { ticket_id: "TCK-100" } });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.status, "success");
    assert.equal(harness.readCalls.length, 1);
    const prepared = await client.callTool({ name: prepare.name, arguments: {
      ticket_id: "TCK-100", order_id: result.structuredContent.data.ticket.order_id,
      reason_code: "customer_request", requested_amount: 750
    } });
    assert.equal(prepared.isError, false);
    assert.equal(prepared.structuredContent.status, "approval_required");
    assert.equal(prepared.structuredContent.action.approvalRequired, true);
    assert.equal(harness.prepareCalls.length, 1);
    assert.equal(harness.executedOperations.includes("commit"), false);

    harness.runtimeContext.subject.permissions = [];
    assert.deepEqual((await aicf.listTools(request)).tools, []);
    const revoked = await client.callTool({ name: read.name, arguments: { ticket_id: "TCK-100" } });
    assert.equal(revoked.isError, true);
    assert.equal(harness.readCalls.length, 1);
    assert.equal(harness.prepareCalls.length, 1);
    return { registered: registered.registered, reads: 1, preparations: 1, approvalRequired: true, revokedCallBlocked: true, commits: 0 };
  } finally {
    await client.close();
    await sdk.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await verifyMcpSdkConsumer()));
