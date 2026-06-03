import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "src/generated/manifest-types.ts");

const schemas = [
  ["schemas/capability-manifest.schema.json", "CapabilityManifest"],
  ["schemas/entity-manifest.schema.json", "EntityManifest"],
  ["schemas/eval-case.schema.json", "EvalCase"]
];

const banner = [
  "/*",
  " * Generated from schemas/*.schema.json.",
  " * Do not edit by hand. Run `npm run generate:types`.",
  " */",
  ""
].join("\n");

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

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${banner}${sections.join("\n\n")}\n`);
