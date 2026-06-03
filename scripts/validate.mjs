import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPaths = {
  capability: "schemas/capability-manifest.schema.json",
  entity: "schemas/entity-manifest.schema.json",
  eval: "schemas/eval-case.schema.json"
};

const ajv = new Ajv2020({ allErrors: true, strict: false });

async function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

async function listFiles(directory) {
  const absoluteDirectory = path.join(repoRoot, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativeEntry = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(relativeEntry));
    } else {
      files.push(relativeEntry);
    }
  }

  return files;
}

async function readStructuredFile(relativePath) {
  const content = await readFile(path.join(repoRoot, relativePath), "utf8");
  const extension = path.extname(relativePath).toLowerCase();

  if (extension === ".json") {
    return JSON.parse(content);
  }

  if (extension === ".yaml" || extension === ".yml") {
    return YAML.parse(content);
  }

  throw new Error(`Unsupported example file type: ${relativePath}`);
}

function schemaKeyForExample(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");

  if (normalized.includes("/capabilities/")) return "capability";
  if (normalized.includes("/entities/")) return "entity";
  if (normalized.includes("/evals/")) return "eval";

  return null;
}

function formatErrors(errors = []) {
  return errors
    .map((error) => {
      const location = error.instancePath || "/";
      return `  - ${location}: ${error.message}`;
    })
    .join("\n");
}

const schemas = {};
for (const [key, relativePath] of Object.entries(schemaPaths)) {
  const schema = await readJson(relativePath);
  schemas[key] = ajv.compile(schema);
}

const exampleFiles = (await listFiles("examples"))
  .filter((file) => [".json", ".yaml", ".yml"].includes(path.extname(file).toLowerCase()));

let failures = 0;

for (const file of exampleFiles) {
  const schemaKey = schemaKeyForExample(file);
  if (!schemaKey) {
    console.warn(`SKIP ${file}: no schema mapping`);
    continue;
  }

  const value = await readStructuredFile(file);
  const validate = schemas[schemaKey];
  const valid = validate(value);

  if (!valid) {
    failures += 1;
    console.error(`FAIL ${file}`);
    console.error(formatErrors(validate.errors));
  } else {
    console.log(`OK   ${file}`);
  }
}

if (failures > 0) {
  console.error(`Validation failed for ${failures} file(s).`);
  process.exit(1);
}

console.log(`Validated ${exampleFiles.length} example file(s).`);

