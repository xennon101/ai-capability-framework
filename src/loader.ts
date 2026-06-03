import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type {
  AicfDiagnostic,
  LoadedManifest,
  LoadManifestsOptions,
  LoadManifestsResult,
  ManifestKind
} from "./types.js";

const structuredExtensions = new Set([".json", ".yaml", ".yml"]);
const ignoredDirectories = new Set([".git", "_private", "node_modules"]);

export async function loadManifests(options: LoadManifestsOptions = {}): Promise<LoadManifestsResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const basePath = path.resolve(root, options.path ?? "examples");
  const manifests: LoadedManifest[] = [];
  const errors: AicfDiagnostic[] = [];
  let files: string[];

  try {
    files = await listStructuredFiles(basePath);
  } catch (error) {
    return {
      basePath,
      errors: [{
        code: "unsupported",
        message: error instanceof Error ? error.message : "Unable to read manifest path.",
        path: toRelativePath(root, basePath)
      }],
      manifests,
      root
    };
  }

  for (const absolutePath of files) {
    const kind = kindFromPath(absolutePath);
    if (!kind) {
      continue;
    }

    const relativePath = toRelativePath(root, absolutePath);
    try {
      const manifest = await readStructuredFile(absolutePath);
      manifests.push({
        absolutePath,
        kind,
        manifest,
        path: relativePath
      } as LoadedManifest);
    } catch (error) {
      errors.push({
        code: "parse",
        kind,
        message: error instanceof Error ? error.message : "Unable to parse manifest.",
        path: relativePath
      });
    }
  }

  return {
    basePath,
    errors,
    manifests,
    root
  };
}

export function kindFromPath(filePath: string): ManifestKind | null {
  const parts = filePath.replaceAll("\\", "/").split("/");

  if (parts.includes("capabilities")) return "capability";
  if (parts.includes("entities")) return "entity";
  if (parts.includes("evals")) return "eval";

  return null;
}

async function listStructuredFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...await listStructuredFiles(path.join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && structuredExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function readStructuredFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".json") {
    return JSON.parse(content);
  }

  return YAML.parse(content);
}

function toRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).replaceAll("\\", "/");
}
