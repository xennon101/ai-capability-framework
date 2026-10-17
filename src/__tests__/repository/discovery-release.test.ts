import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { isNpmNotFound } from "../../../scripts/npm-registry-state.mjs";

describe("discovery release guards", () => {
  it("accepts only explicit npm E404 errors", () => {
    expect(isNpmNotFound({ status: 1, stdout: JSON.stringify({ error: { code: "E404" } }) })).toBe(true);
    expect(isNpmNotFound({ status: 1, stderr: "npm error code E404\nnpm error 404 Not Found" })).toBe(true);
    for (const stderr of ["404", "No match found", "ENOTFOUND", "npm error code E401", "npm error code E503", "upstream returned 404"]) {
      expect(isNpmNotFound({ status: 1, stderr })).toBe(false);
    }
    expect(isNpmNotFound({ status: 0, stderr: "npm error code E404\n" })).toBe(false);
  });

  it("serializes tag-only OIDC publication and retains all release checks", () => {
    const workflow = parse(readFileSync(".github/workflows/publish.yml", "utf8"));
    expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
    expect(workflow.permissions["id-token"]).toBe("write");
    expect(workflow.concurrency).toEqual({ group: "npm-publication", "cancel-in-progress": false });
    const job = workflow.jobs.publish;
    expect(job.env.VITEST_MAX_WORKERS).toBe("2");
    const commands = job.steps.map((step: { run?: string }) => step.run ?? "").join("\n");
    expect(commands).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(commands).toContain("npm run check && npm run check:certification");
    expect(commands).toContain("npm run release:preflight:npm");
    expect(commands).not.toContain("NPM_TOKEN");
    expect(commands).toContain("tag=next");
    expect(commands.indexOf("npm run release:preflight:npm")).toBeLessThan(commands.indexOf("npm publish"));
  });

  it("keeps dry-run certification provider-free and bounded", () => {
    const workflow = parse(readFileSync(".github/workflows/release-dry-run.yml", "utf8"));
    expect(workflow.on).toEqual({ workflow_dispatch: null });
    const job = workflow.jobs["release-dry-run"];
    expect(job.env.VITEST_MAX_WORKERS).toBe("2");
    expect(job.steps.some((step: { run?: string }) => step.run === "npm run check && npm run check:certification")).toBe(true);
  });

  it("documents qualification without promoting hybrid or rewriting live history", () => {
    const guide = readFileSync("docs/evals/discovery-qualification.md", "utf8").replace(/\s+/gu, " ");
    for (const text of ["recommended default", "experimental and opt-in", "1.67 percentage points", "40/48", "48/48", "not a fresh live trial", "47/48 lexical", "95% Wilson", "release-candidate public"]) {
      expect(guide).toContain(text);
    }
    const overview = readFileSync("docs/discovery.md", "utf8");
    expect(overview).toContain("npm install ai-capability-framework");
    expect(overview).toContain("api/stable-workflow.md");
    expect(overview).toContain("evals/discovery-qualification.md");
  });
});
