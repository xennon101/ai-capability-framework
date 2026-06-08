import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type {
  AicfDiagnostic,
  LoadedManifest,
  LoadedFixture,
  LoadManifestsOptions,
  LoadManifestsResult,
  ManifestKind
} from "./types.js";

const structuredExtensions = new Set([".json", ".yaml", ".yml"]);
const ignoredDirectories = new Set([".git", "_private", "node_modules"]);

export async function loadManifests(options: LoadManifestsOptions = {}): Promise<LoadManifestsResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const basePath = path.resolve(root, options.path ?? "examples");
  const fixtures: LoadedFixture[] = [];
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
      fixtures,
      manifests,
      root
    };
  }

  for (const absolutePath of files) {
    const kind = kindFromPath(absolutePath);
    const relativePath = toRelativePath(root, absolutePath);

    try {
      const parsed = await readStructuredFile(absolutePath);
      if (kind) {
        manifests.push({
          absolutePath,
          kind,
          manifest: parsed,
          path: relativePath
        } as LoadedManifest);
      } else {
        fixtures.push({
          absolutePath,
          fixture: parsed,
          kind: fixtureKindFromPath(absolutePath),
          path: relativePath
        });
      }
    } catch (error) {
      errors.push({
        code: "parse",
        kind: kind ?? undefined,
        message: error instanceof Error ? error.message : "Unable to parse manifest.",
        path: relativePath
      });
    }
  }

  return {
    basePath,
    errors,
    fixtures,
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

export function fixtureKindFromPath(filePath: string): LoadedFixture["kind"] {
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const fileName = parts.at(-1) ?? "";

  if (fileName === "aicf.config.json" || fileName === "aicf.config.yaml" || fileName === "aicf.config.yml") {
    return "governance_gate_config";
  }

  if (parts.includes("control-plane") && parts.includes("fixtures")) return "control_plane_state";
  if (parts.includes("eval-results")) return "eval_result";
  if (parts.includes("memory")) return "governed_memory";
  if (parts.includes("provenance")) return "generated_content_provenance";
  if (parts.includes("replay")) return "replay_trace";
  if (parts.includes("decisions")) return "decision_request";
  if (parts.includes("openai") && fileName.startsWith("context.") && fileName.endsWith(".json")) {
    return "adapter_context";
  }

  return "unknown";
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
