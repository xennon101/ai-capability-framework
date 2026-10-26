import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const legacyUri = {
  version: "3.1.7",
  resolved: "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.7.tgz",
  integrity: "sha512-dOvZVzjdZdz7phd9v6jCbwxrBW3fK6n8Rc0CtdmM4bumzMnxywBYhuph6J819RRw/ku+rLbelwfMunktuzVVHg=="
};

/** Qualifies installed artifacts; never changes the repository's dependency tree. */
export async function checkSecurityInstall({ directory, repoRoot, installSource, npmCommand, npmArgs }) {
  const invoke = (cwd, ...args) => execFileSync(npmCommand, npmArgs(...args), { cwd, encoding: "utf8", stdio: "pipe" });
  const audit = (cwd) => {
    const report = JSON.parse(invoke(cwd, "audit", "--omit=dev", "--audit-level=low", "--json"));
    assert.equal(report.metadata.vulnerabilities.total, 0, "Installed production dependencies must audit clean.");
  };
  const baseLock = JSON.parse(await readFile(path.join(directory, "package-lock.json"), "utf8"));
  assert.equal(baseLock.packages["node_modules/zod"], undefined, "SDK-free installation must not acquire Zod.");
  assert.equal(baseLock.packages["node_modules/@modelcontextprotocol/sdk"], undefined, "SDK-free installation must not acquire MCP.");
  audit(directory);
  const temporary = [];
  const create = async (dependencies = {}) => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aicf-security-consumer-"));
    temporary.push(cwd);
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({
      name: "aicf-security-consumer", version: "0.0.0", private: true, type: "module", dependencies
    }));
    return cwd;
  };
  const checks = [];
  try {
    const developmentZod = JSON.parse(await readFile(path.join(repoRoot, "node_modules/zod/package.json"), "utf8")).version;
    for (const version of new Set(["4.6.6", developmentZod])) {
      const cwd = await create();
      invoke(cwd, "install", "--strict-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund", installSource, `zod@${version}`);
      await writeFile(path.join(cwd, "check.mjs"), `
        import assert from "node:assert/strict";
        import { z } from "zod";
        import { createLangChainZodSchemaFactory } from "ai-capability-framework/providers/langchain";
        let inspected = 0;
        const bounded = z.array(z.string().refine(() => { inspected++; return true; })).max(2);
        assert.equal(bounded.safeParse(["a", "b", "c", "d"]).success, false);
        assert.equal(inspected, 0);
        assert.equal(bounded.safeParse(["a", "b"]).success, true);
        assert.equal(inspected, 2);
        const converted = createLangChainZodSchemaFactory(z).createSchema({
          type: "object", properties: { names: { type: "array", items: { type: "string" } } },
          required: ["names"], additionalProperties: false
        });
        assert.deepEqual(converted.diagnostics, []);
        assert.equal(converted.schema.safeParse({ names: ["example"] }).success, true);
        assert.equal(converted.schema.safeParse({ names: [42] }).success, false);
      `);
      execFileSync(process.execPath, ["check.mjs"], { cwd, stdio: "pipe" });
      audit(cwd);
      checks.push(`Zod ${version}`);
    }

    for (const version of ["1.32.0", "1.32.2"]) {
      const cwd = await create();
      invoke(cwd, "install", "--strict-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund", installSource, `@modelcontextprotocol/sdk@${version}`);
      await writeFile(path.join(cwd, "check.mjs"), await readFile(path.join(repoRoot, "scripts/fixtures/mcp-sdk-consumer.mjs")));
      execFileSync(process.execPath, ["check.mjs"], { cwd, stdio: "pipe" });
      await writeFile(path.join(cwd, "types.mts"), `
        import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
        import { AicfMcpServer, registerAicfMcpTools } from "ai-capability-framework/mcp-server";
        declare const aicfServer: AicfMcpServer;
        const mcpServer = new McpServer({ name: "synthetic-consumer", version: "1.0.0" });
        const result: Promise<{ registered: number; toolNames: string[] }> = registerAicfMcpTools({ aicfServer, mcpServer });
        void result;
      `);
      execFileSync(process.execPath, [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", "types.mts"], { cwd, stdio: "pipe" });
      audit(cwd);
      checks.push(`MCP ${version} read/prepare/revocation`);
    }

    const conflicting = await create({ zod: "4.4.3" });
    const rejected = spawnSync(npmCommand, npmArgs("install", "--strict-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund", installSource), {
      cwd: conflicting, encoding: "utf8"
    });
    assert.notEqual(rejected.status, 0, "An explicitly installed unsupported peer must conflict.");
    assert.match((rejected.stdout ?? "") + (rejected.stderr ?? ""), /ERESOLVE/u);

    const oldMcp = await create({ "@modelcontextprotocol/sdk": "1.29.0" });
    const rejectedMcp = spawnSync(npmCommand, npmArgs("install", "--strict-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund", installSource), {
      cwd: oldMcp, encoding: "utf8"
    });
    assert.notEqual(rejectedMcp.status, 0, "An explicitly installed unsupported MCP peer must conflict.");
    assert.match((rejectedMcp.stdout ?? "") + (rejectedMcp.stderr ?? ""), /ERESOLVE/u);

    const legacy = await create();
    invoke(legacy, "install", "--ignore-scripts", "--no-audit", "--no-fund", "ai-capability-framework@1.1.0");
    const lockPath = path.join(legacy, "package-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    assert.ok(lock.packages["node_modules/fast-uri"]);
    Object.assign(lock.packages["node_modules/fast-uri"], legacyUri);
    await writeFile(lockPath, JSON.stringify(lock, null, 2));
    invoke(legacy, "ci", "--ignore-scripts", "--no-audit", "--no-fund");
    assert.equal(JSON.parse(await readFile(path.join(legacy, "node_modules/fast-uri/package.json"), "utf8")).version, "3.1.7");
    // Run the documented framework upgrade and targeted transitive update in order.
    invoke(legacy, "install", "--ignore-scripts", "--no-audit", "--no-fund", installSource);
    invoke(legacy, "update", "fast-uri", "--ignore-scripts", "--no-audit", "--no-fund");
    const upgraded = JSON.parse(await readFile(path.join(legacy, "node_modules/fast-uri/package.json"), "utf8")).version.split(".").map(Number);
    assert.ok(upgraded[0] === 3 && (upgraded[1] > 1 || (upgraded[1] === 1 && upgraded[2] >= 9)));
    audit(legacy);
    console.log(`Security consumers: SDK-free audit, ${checks.join(" / ")}, old-peer rejection and legacy-lock remediation passed.`);
  } finally {
    if (process.env.AICF_KEEP_TMP === "1") console.log(`Security consumer directories: ${temporary.join(", ")}`);
    else for (const cwd of temporary) await rm(cwd, { recursive: true, force: true });
  }
}
