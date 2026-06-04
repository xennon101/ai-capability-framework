import { describe, expect, it } from "vitest";
import {
  createEvalCaseFromLangfuseDatasetItem,
  createLangfuseDatasetItemsFromEvalCases,
  LangfuseTraceSink
} from "../../langfuse/index.js";
import type { EvalCase } from "../../index.js";

describe("Langfuse optional adapter", () => {
  it("emits sanitized trace events through a fake client and flushes when supported", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const client = {
      flush: () => calls.push({ method: "flush", payload: undefined }),
      generation: (payload: unknown) => calls.push({ method: "generation", payload }),
      score: (payload: unknown) => calls.push({ method: "score", payload }),
      trace: (payload: unknown) => calls.push({ method: "trace", payload })
    };
    const sink = new LangfuseTraceSink({ client });

    await sink.emit({
      attributes: {
        apiKey: "secret",
        score: 1,
        scorer: "policy_decision_matches"
      },
      requestId: "req_test",
      runId: "run_test",
      timestamp: "2026-06-04T00:00:00.000Z",
      type: "eval.score"
    });
    await sink.flush();

    expect(calls.map((call) => call.method)).toEqual(["trace", "generation", "score", "flush"]);
    expect(JSON.stringify(calls)).not.toContain("secret");
  });

  it("does not crash when client methods are missing", async () => {
    const sink = new LangfuseTraceSink({ client: {} });

    await expect(sink.emit({
      attributes: {},
      requestId: "req_test",
      runId: "run_test",
      timestamp: "2026-06-04T00:00:00.000Z",
      type: "runtime.start"
    })).resolves.toBeUndefined();

    expect(sink.diagnostics).toContainEqual(expect.objectContaining({
      code: "langfuse_method_missing"
    }));
  });

  it("converts eval cases to public-safe dataset items and back", () => {
    const evalCase: EvalCase = {
      expected: {
        selected_capabilities: {
          includes: ["support.ticket.get"]
        }
      },
      id: "support.ticket.get.valid",
      input: {
        user_message: "Read ticket TCK-100."
      },
      schema_version: "1.0",
      scorers: [{ type: "tool_selection_includes" }]
    };
    const items = createLangfuseDatasetItemsFromEvalCases([evalCase]);
    const roundTrip = createEvalCaseFromLangfuseDatasetItem(items[0]!);

    expect(items[0]).toMatchObject({
      id: "support.ticket.get.valid",
      input: {
        user_message: "Read ticket TCK-100."
      }
    });
    expect(JSON.stringify(items)).not.toContain("_private");
    expect(roundTrip.id).toBe("support.ticket.get.valid");
    expect(roundTrip.scorers[0]?.type).toBe("tool_selection_includes");
  });

  it("exports built Langfuse subpath APIs", async () => {
    const langfuse = await import("../../../dist/langfuse/index.js") as Record<string, unknown>;

    expect(langfuse.LangfuseTraceSink).toEqual(expect.any(Function));
    expect(langfuse.createLangfuseDatasetItemsFromEvalCases).toEqual(expect.any(Function));
  });
});
