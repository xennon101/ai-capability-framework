import { readFile } from "node:fs/promises";
import { outputPath, renderGeneratedTypes } from "./generate-types.mjs";

const expected = await renderGeneratedTypes();
const current = await readFile(outputPath, "utf8");

if (current !== expected) {
  console.error("Generated manifest types are stale. Run `npm run generate:types`.");
  process.exitCode = 1;
}
