import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RunContext, setTracingDisabled } from "@openai/agents";
import { buildAgentsSdkTools, createDefaultAgentsSdkBridgeFactory } from "ai-capability-framework/openai";
import { DefaultContextBuilder, DefaultCapabilityRouter } from "ai-capability-framework/runtime";

export async function verifyAgentsSdkConsumer() {
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error("Unexpected network access in SDK fixture."); };
  setTracingDisabled(true);
  try {
    const directory = path.dirname(fileURLToPath(import.meta.resolve("ai-capability-framework/package.json")));
    const { createCustomerHarness } = await import(pathToFileURL(path.join(directory, "examples/12-capability-discovery-selection/customer-harness.mjs")).href);
    const harness = await createCustomerHarness(), userInput = { text: "Read ticket TCK-100 and prepare a refund for its order." };
    const builtContext = await new DefaultContextBuilder().build({ baseContext: harness.runtimeContext, registry: harness.registry, userInput });
    const factory = await createDefaultAgentsSdkBridgeFactory();
    const tools = await buildAgentsSdkTools({ ...harness, builtContext, userInput, factory, router: new DefaultCapabilityRouter() });
    assert(tools.length > 0);
    assert(tools.every(tool => tool.type === "function" && !tool.name.includes("commit")));
    const read = tools.find(t => t.name.includes("support_ticket_get")), prepare = tools.find(t => t.name.includes("support_refund_prepare_case"));
    assert(read && prepare);
    assert.match(read.description, /ticket/iu);
    const context = new RunContext({});
    const invalid = await read.invoke(context, JSON.stringify({ ticket_id: 42 }));
    assert.equal(harness.readCalls.length, 0);
    assert(invalid === "The AICF tool failed safely." || JSON.parse(invalid).status === "validation_error");
    const result = JSON.parse(await read.invoke(context, JSON.stringify({ ticket_id: "TCK-100" })));
    assert.equal(result.status, "success");
    assert.equal(harness.readCalls.length, 1);
    const prepared = JSON.parse(await prepare.invoke(context, JSON.stringify({ ticket_id: "TCK-100", order_id: result.data.ticket.order_id,
      reason_code: "customer_request", requested_amount: 750 })));
    assert.equal(prepared.status, "approval_required");
    assert.equal(prepared.action.approvalRequired, true);
    assert.equal(harness.prepareCalls.length, 1);
    harness.runtimeContext.subject.permissions = [];
    const revoked = JSON.parse(await read.invoke(context, JSON.stringify({ ticket_id: "TCK-100" })));
    assert.equal(revoked.status, "denied");
    assert.equal(harness.readCalls.length, 1);
    assert.equal(harness.executedOperations.includes("commit"), false);
    const failed = factory.createFunctionTool({ name: "synthetic_failure", description: "Synthetic failure.", strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, execute: async () => { throw new Error("private synthetic failure"); } });
    assert.equal(await failed.invoke(context, "{}"), "The AICF tool failed safely.");
    assert.equal(networkAttempts, 0);
    return { tools: tools.length, reads: 1, preparations: 1, approvalRequired: true, revokedCallBlocked: true, commits: 0, networkAttempts };
  } finally { globalThis.fetch = originalFetch; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyAgentsSdkConsumer()));
