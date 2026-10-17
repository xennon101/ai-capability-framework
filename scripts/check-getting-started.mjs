import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The published tutorial is the source of the consumer's files. */
export function extractGettingStartedFiles(markdown) {
  const fence = (language) => {
    const matches = [...markdown.matchAll(new RegExp("```" + language + "\\r?\\n([\\s\\S]*?)\\r?\\n```", "gu"))];
    assert.equal(matches.length, 1, `Expected one complete ${language} tutorial file.`);
    return matches[0][1] + "\n";
  };
  return { manifest: JSON.parse(fence("json")), application: fence("js") };
}

export async function checkGettingStarted({ directory, packageDirectory, npmCommand, npmArgs }) {
  const markdown = await readFile(path.join(packageDirectory, "docs/getting-started/provider-neutral-quickstart.md"), "utf8");
  const { manifest, application } = extractGettingStartedFiles(markdown);
  await mkdir(path.join(directory, "capabilities"));
  await writeFile(path.join(directory, "capabilities/ticket.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  await writeFile(path.join(directory, "app.mjs"), application, { flag: "wx" });
  const validation = execFileSync(npmCommand, npmArgs("exec", "--", "aicf", "validate", "capabilities"), {
    cwd: directory, encoding: "utf8", stdio: "pipe"
  });
  assert.match(validation, /Validated 1 manifest\(s\)/u);
  const output = execFileSync(process.execPath, ["--import", pathToFileURL(path.join(directory, "no-network.mjs")).href, "app.mjs"], {
    cwd: directory, encoding: "utf8", stdio: "pipe"
  });
  assert.deepEqual(JSON.parse(output), {
    queryId: "read-ticket", capabilityId: "support.ticket.get", toolStatus: "success",
    data: { ticket_id: "TCK-100", status: "open" }, reads: 1, ordinaryModelTurns: 2, discoveryProviderCalls: 0
  });
  console.log("Installed quickstart: exact documented manifest/app, CLI validation, one authorized read, two mock turns and zero discovery calls passed.");
}
