import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const requiredApiTypes = {
  index: ["LoadedManifestBase", "AutonomyTier", "JsonSchemaObject", "ExpectedBehavior", "PolicyRule", "ToolResultInput"],
  runtime: ["AicfVerifyActionInput"],
  "evals-live": ["AicfLiveEvalResult"]
};

export function apiDocumentationFailures(project) {
  const failures = [];
  for (const [module, types] of Object.entries(requiredApiTypes)) {
    const children = project?.children?.find(item => item.name === module)?.children ?? [];
    for (const type of types) if (!children.some(item => item.name === type)) failures.push(`Missing documented public type: ${module}.${type}`);
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const project = JSON.parse(readFileSync(path.join(root, "generated-docs/api/reflections.json"), "utf8"));
  const failures = apiDocumentationFailures(project);
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
  console.log("Public API documentation references passed.");
}
