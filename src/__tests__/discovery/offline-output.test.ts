import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../examples/12-capability-discovery-selection/evaluation/regrade.mjs", () => ({ regradeSavedCampaign: vi.fn() }));
import { regradeSavedCampaign } from "../../../examples/12-capability-discovery-selection/evaluation/regrade.mjs";
import { writeOfflineRegrade } from "../../../examples/12-capability-discovery-selection/run-evaluation-regrade.mjs";

const directories: string[] = [];
let root: string, input: string, source: string, report: string;
beforeEach(() => {
  const ignored = path.resolve(".aicf"); mkdirSync(ignored, { recursive: true });
  root = mkdtempSync(path.join(ignored, "offline-output-test-")); directories.push(root);
  source = path.join(root, "campaign"); mkdirSync(source); writeFileSync(path.join(source, "journal.jsonl"), "preserved journal\n");
  input = path.join(root, "input.json"); writeFileSync(input, "{}");
  report = path.join(root, "original.json"); writeFileSync(report, "preserved report");
  vi.mocked(regradeSavedCampaign).mockReturnValue({ value: { reportFingerprint: "synthetic", original: {}, revised: {}, executionUsage: { providerAttempts: 0 } },
    evidence: { directory: source, reportPath: report } });
});
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe("offline output publication boundary", () => {
  it("publishes atomically, accepts identical output and preserves source bytes", () => {
    const output = path.join(root, "result"), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network"));
    expect(writeOfflineRegrade(input, output).reportFingerprint).toBe("synthetic");
    const bytes = readFileSync(path.join(output, "regrade.json"));
    expect(writeOfflineRegrade(input, output).reportFingerprint).toBe("synthetic");
    expect(readFileSync(path.join(output, "regrade.json"))).toEqual(bytes);
    expect(readFileSync(path.join(source, "journal.jsonl"), "utf8")).toBe("preserved journal\n");
    expect(readFileSync(report, "utf8")).toBe("preserved report");
    expect(readdirSync(root).some(name => name.includes(".pending-"))).toBe(false); expect(network).not.toHaveBeenCalled();
  });
  it("refuses conflicting output without modifying it", () => {
    const output = path.join(root, "result"); mkdirSync(output); writeFileSync(path.join(output, "regrade.json"), "conflict");
    expect(() => writeOfflineRegrade(input, output)).toThrow(/Conflicting/);
    expect(readFileSync(path.join(output, "regrade.json"), "utf8")).toBe("conflict");
  });
  it.each(["campaign", "campaign/child", "."])("refuses input/output overlap: %s", relative => {
    expect(() => writeOfflineRegrade(input, path.join(root, relative))).toThrow(/separate/);
    expect(readFileSync(path.join(source, "journal.jsonl"), "utf8")).toBe("preserved journal\n");
  });
  it("requires ignored output before reading campaign evidence", () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "aicf-untracked-output-")); directories.push(temporary);
    vi.mocked(regradeSavedCampaign).mockClear();
    expect(() => writeOfflineRegrade(input, path.join(temporary, "result"))).toThrow();
    expect(regradeSavedCampaign).not.toHaveBeenCalled();
  });
});
