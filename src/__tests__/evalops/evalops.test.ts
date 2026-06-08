import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { EvalCase } from "../../index.js";
import {
  exportBraintrustDataset,
  exportOpenAIEvalDataset,
  importBraintrustResults,
  importOpenAIEvalResults
} from "../../evalops/index.js";

const evalCase: EvalCase = {
  capability_under_test: "support.ticket.get",
  expected: {
    response: {
      must_include: ["Ticket"],
      must_not_include: ["private_diagnostics"]
    },
    selected_capabilities: {
      includes: ["support.ticket.get"]
    }
  },
  id: "support.ticket.get.evalops",
  input: {
    user_message: "Read ticket TCK-100 with Bearer sample-token."
  },
  schema_version: "1.0",
  scorers: [
    { type: "tool_selection_includes" },
    { type: "response_excludes_private_detail" }
  ],
  tags: ["support", "evalops"]
};

describe("EvalOps exporters", () => {
  it("exports public-safe Braintrust and OpenAI eval datasets", async () => {
    const braintrust = exportBraintrustDataset([evalCase]);
    const openai = exportOpenAIEvalDataset([evalCase]);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const braintrustSchema = JSON.parse(await readFile("schemas/evalops/braintrust-dataset.schema.json", "utf8")) as Record<string, unknown>;
    const openaiSchema = JSON.parse(await readFile("schemas/evalops/openai-eval-dataset.schema.json", "utf8")) as Record<string, unknown>;

    expect(ajv.compile(braintrustSchema)(braintrust), ajv.errorsText()).toBe(true);
    expect(ajv.compile(openaiSchema)(openai), ajv.errorsText()).toBe(true);
    expect(braintrust.items[0]).toMatchObject({
      id: "support.ticket.get.evalops",
      metadata: {
        aicf_eval_id: "support.ticket.get.evalops",
        capability_under_test: "support.ticket.get"
      }
    });
    expect(openai.data[0]?.input[0]).toMatchObject({
      role: "user"
    });
    expect(JSON.stringify({ braintrust, openai })).not.toContain("sample-token");
    expect(JSON.stringify({ braintrust, openai })).not.toContain("rawProviderPayload");
  });

  it("imports Braintrust and OpenAI result fixtures into AICF result shapes", () => {
    const braintrust = importBraintrustResults({
      json: {
        results: [{
          id: "support.ticket.get.evalops",
          output: "Ticket summary",
          score: 1,
          success: true
        }]
      }
    });
    const openai = importOpenAIEvalResults({
      json: {
        data: [{
          eval_id: "support.ticket.get.evalops",
          response: "private diagnostics absent",
          status: "passed"
        }]
      }
    });

    expect(braintrust[0]).toMatchObject({
      evalId: "support.ticket.get.evalops",
      status: "passed"
    });
    expect(braintrust[0]?.candidate.response?.text).toBe("Ticket summary");
    expect(openai[0]?.scores[0]?.scorer).toBe("openai_eval_result");
    expect(JSON.stringify(openai)).not.toContain("private_diagnostics");
  });

  it("exports built EvalOps subpath APIs", async () => {
    const evalops = await import("../../../dist/evalops/index.js") as Record<string, unknown>;

    expect(evalops.exportBraintrustDataset).toEqual(expect.any(Function));
    expect(evalops.importBraintrustResults).toEqual(expect.any(Function));
    expect(evalops.exportOpenAIEvalDataset).toEqual(expect.any(Function));
    expect(evalops.importOpenAIEvalResults).toEqual(expect.any(Function));
  });
});
