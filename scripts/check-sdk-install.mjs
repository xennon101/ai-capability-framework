import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Actual optional SDKs with deterministic local transports; never loads host credentials. */
export async function checkSdkInstall({ repoRoot, installSource, npmCommand, npmArgs }) {
  const awsPackages = ["client-cloudwatch", "client-cloudwatch-logs", "client-dynamodb", "client-eventbridge", "client-kms", "client-sfn", "lib-dynamodb"].map(n => "@aws-sdk/" + n);
  const cases = [
    ...["0.11.6", "0.21.0"].map(version => ({ family: "agents", version, packages: [`@openai/agents@${version}`] })),
    ...["6.42.0", "7.43.0"].map(version => ({ family: "openai", version, packages: [`openai@${version}`] })),
    ...["3.1061.0", "3.1156.0"].map(version => ({ family: "aws", version, packages: [
      ...awsPackages.map(name => `${name}@${version}`),
      // New util-dynamodb releases raise their client peer floor. Bind the
      // compatible published helper when testing the historical client minimum.
      ...(version === "3.1061.0" ? ["@aws-sdk/util-dynamodb@3.996.2"] : [])
    ] }))
  ];
  const directories = [], receipts = [];
  try {
    for (const entry of cases) {
      const cwd = await mkdtemp(path.join(tmpdir(), "aicf-sdk-consumer-")); directories.push(cwd);
      await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "aicf-sdk-consumer", version: "0.0.0", private: true, type: "module" }));
      execFileSync(npmCommand, npmArgs("install", "--strict-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund", installSource, ...entry.packages), { cwd, stdio: "pipe" });
      const installedName = entry.family === "agents" ? "@openai/agents" : entry.family === "openai" ? "openai" : "@aws-sdk/client-cloudwatch";
      assert.equal(JSON.parse(await readFile(path.join(cwd, "node_modules", installedName, "package.json"), "utf8")).version, entry.version);
      await writeFile(path.join(cwd, "check.mjs"), await readFile(path.join(repoRoot, "scripts/fixtures", entry.family + "-sdk-consumer.mjs")));
      const output = execFileSync(process.execPath, ["check.mjs"], { cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, OPENAI_AGENTS_DISABLE_TRACING: "1" } });
      const result = JSON.parse(output.trim());
      const source = entry.family === "agents" ? `
        import { createDefaultAgentsSdkBridgeFactory, type AicfAgentsSdkToolBridgeFactory } from "ai-capability-framework/openai";
        const factory: AicfAgentsSdkToolBridgeFactory = await createDefaultAgentsSdkBridgeFactory(); void factory;
      ` : entry.family === "openai" ? `
        import OpenAI from "openai";
        import { createOpenAIResponsesClientFromSdk, type AicfOpenAIResponsesClient } from "ai-capability-framework/openai";
        const client: AicfOpenAIResponsesClient = createOpenAIResponsesClientFromSdk(new OpenAI({ apiKey: "synthetic" })); void client;
      ` : `
        import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
        import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
        import { DynamoDbAuditSink } from "ai-capability-framework/aws";
        const store = new DynamoDbAuditSink({ documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })), tableName: "synthetic" }); void store;
      `;
      await writeFile(path.join(cwd, "types.mts"), source);
      execFileSync(process.execPath, [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", "types.mts"], { cwd, stdio: "pipe" });
      const audit = JSON.parse(execFileSync(npmCommand, npmArgs("audit", "--audit-level=low", "--json"), { cwd, encoding: "utf8", stdio: "pipe" }));
      assert.equal(audit.metadata.vulnerabilities.total, 0);
      receipts.push({ family: entry.family, version: entry.version, result, auditVulnerabilities: 0, directory: cwd });
      console.log(`SDK compatibility case: ${entry.family} ${entry.version}: ${JSON.stringify(result)}; audit findings: 0.`);
    }
    const openai = receipts.filter(r => r.family === "openai");
    assert.equal(openai[0].result.selectionRequestFingerprint, openai[1].result.selectionRequestFingerprint, "SDK upgrades must preserve model-facing selection requests.");
    assert.deepEqual(openai[0].result.ordinary.map(r => r.requestFingerprint), openai[1].result.ordinary.map(r => r.requestFingerprint), "SDK upgrades must preserve model-facing ordinary requests.");
    console.log(`SDK compatibility consumers: ${receipts.map(r => `${r.family} ${r.version}`).join(" / ")} passed with local transports and zero audit findings.`);
    if (process.env.AICF_KEEP_TMP === "1") console.log(`SDK compatibility receipts: ${JSON.stringify(receipts)}`);
    return receipts;
  } finally {
    if (process.env.AICF_KEEP_TMP !== "1") for (const cwd of directories) await rm(cwd, { recursive: true, force: true });
  }
}
