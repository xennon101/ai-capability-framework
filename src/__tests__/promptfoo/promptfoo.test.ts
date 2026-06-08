import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli, type EvalCase } from "../../index.js";
import {
  exportPromptfooSuite,
  importPromptfooResults
} from "../../promptfoo/index.js";

const evalCase: EvalCase = {
  expected: {
    response: {
      must_include: ["prepared"],
      must_not_include: ["private_diagnostics"]
    }
  },
  id: "support.refund.prepare_case.valid",
  input: {
    user_message: "Prepare a refund case."
  },
  schema_version: "1.0",
  scorers: [{ type: "response_excludes_private_detail" }]
};

describe("Promptfoo export and import", () => {
  it("exports public-safe suite files with echo provider by default", () => {
    const suite = exportPromptfooSuite({
      ciCommand: "npx promptfoo eval -c promptfooconfig.yaml",
      evalCases: [evalCase],
      providerTargets: [{
        id: "openai:responses",
        label: "Host OpenAI runtime placeholder"
      }],
      targetUrlPlaceholder: "https://example.com/aicf/runtime"
    });

    expect(suite.files.map((file) => file.path)).toEqual([
      "promptfooconfig.yaml",
      "prompts/aicf-runtime.md",
      "vars/aicf-evals.json",
      "README.md"
    ]);
    expect(suite.files[0]?.content).toContain("echo");
    expect(suite.files[2]?.content).toContain("support.refund.prepare_case.valid");
    expect(suite.files[3]?.content).toContain("Provider Targets");
    expect(suite.files[3]?.content).toContain("openai:responses");
    expect(suite.files[3]?.content).toContain("npx promptfoo eval -c promptfooconfig.yaml");
    expect(suite.files[3]?.content).toContain("https://example.com/aicf/runtime");
    expect(JSON.stringify(suite)).not.toContain("_private");
  });

  it("adds optional synthetic red-team defaults", () => {
    const suite = exportPromptfooSuite({
      evalCases: [evalCase],
      includeRedTeamDefaults: true
    });
    const varsFile = suite.files.find((file) => file.path === "vars/aicf-evals.json")?.content ?? "";

    expect(varsFile).toContain("redteam.prompt_injection");
    expect(varsFile).toContain("redteam.secret_exfiltration");
  });

  it("imports basic Promptfoo JSON results", () => {
    const results = importPromptfooResults({
      json: {
        results: [{
          output: "prepared",
          success: true,
          vars: {
            aicf_eval_id: "support.refund.prepare_case.valid"
          }
        }]
      }
    });

    expect(results[0]).toMatchObject({
      evalId: "support.refund.prepare_case.valid",
      status: "passed"
    });
    expect(results[0]?.candidate?.response?.text).toBe("prepared");
  });

  it("writes Promptfoo files through the CLI", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aicf-promptfoo-"));
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli([
      "export",
      "promptfoo",
      "examples",
      "--out",
      directory,
      "--include-red-team-defaults"
    ], { stderr, stdout });
    const config = await readFile(path.join(directory, "promptfooconfig.yaml"), "utf8");

    expect(exitCode).toBe(0);
    expect(stderr.value).toBe("");
    expect(config).toContain("prompts/aicf-runtime.md");
    expect(stdout.value).toContain("promptfooconfig.yaml");
  });

  it("exports built Promptfoo subpath APIs", async () => {
    const promptfoo = await import("../../../dist/promptfoo/index.js") as Record<string, unknown>;

    expect(promptfoo.exportPromptfooSuite).toEqual(expect.any(Function));
    expect(promptfoo.importPromptfooResults).toEqual(expect.any(Function));
  });
});

function createWritableBuffer(): { value: string; write(chunk: string): void } {
  return {
    value: "",
    write(chunk: string) {
      this.value += chunk;
    }
  };
}
