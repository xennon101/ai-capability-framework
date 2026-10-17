import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("installed CLI entrypoint", () => {
  // npm uses a script shim on Windows; the packed-consumer check exercises that path.
  it.skipIf(process.platform === "win32")("runs through npm's POSIX bin symlink", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aicf-cli-link-"));
    try {
      const link = path.join(directory, "aicf");
      await symlink(path.resolve("dist/cli.js"), link);
      const output = execFileSync(process.execPath, [link, "--help"], { encoding: "utf8" });
      expect(output).toContain("Usage: aicf <command> [path]");
      expect(output).toContain("Commands:");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not execute the CLI when imported programmatically", () => {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e",
      'await import("ai-capability-framework/cli"); console.log("import-only");'], { encoding: "utf8" });
    expect(output.trim()).toBe("import-only");
  });
});
