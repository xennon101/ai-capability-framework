import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const outputPath = path.join(repoRoot, "src/generated/manifest-types.ts");

const schemas = [
  ["schemas/adapter-context.schema.json", "AdapterContextFixture"],
  ["schemas/capability-manifest.schema.json", "CapabilityManifest"],
  ["schemas/decision-request.schema.json", "DecisionRequestFixture"],
  ["schemas/entity-manifest.schema.json", "EntityManifest"],
  ["schemas/eval-case.schema.json", "EvalCase"],
  ["schemas/eval-result.schema.json", "EvalResultFixture"],
  ["schemas/tool-result-envelope.schema.json", "ToolResultEnvelopeFixture"]
];

const banner = [
  "/*",
  " * Generated from schemas/*.schema.json.",
  " * Do not edit by hand. Run `npm run generate:types`.",
  " */",
  ""
].join("\n");

export async function renderGeneratedTypes() {
  const sections = [];
  for (const [schemaPath, typeName] of schemas) {
    const schema = JSON.parse(await readFile(path.join(repoRoot, schemaPath), "utf8"));
    delete schema.$id;
    delete schema.title;
    const compiled = await compile(schema, typeName, {
      additionalProperties: false,
      bannerComment: "",
      unreachableDefinitions: true
    });
    sections.push(compiled.trim());
  }

  return `${banner}${sections.join("\n\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await renderGeneratedTypes());
}
