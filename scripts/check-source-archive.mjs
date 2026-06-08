import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import YAML from "yaml";

const repoRoot = process.cwd();
const archivePath = path.join(repoRoot, "dist-source", "ai-capability-framework-source.zip");

if (!existsSync(archivePath)) {
  console.error("Source archive is missing. Run `npm run archive:source` first.");
  process.exit(1);
}

const archive = readFileSync(archivePath);
const entries = readZipEntries(archive);
const failures = [];

for (const entry of entries) {
  const name = normalizeEntryName(entry.name);
  if (!name || entry.isDirectory) {
    continue;
  }

  failures.push(...pathFailures(name));

  const data = readEntryData(archive, entry);
  if (data.includes(0)) {
    failures.push(`NUL byte found in source archive file: ${name}`);
  }

  if ((name.startsWith("examples/") || name.startsWith("conformance/")) && name.endsWith(".json")) {
    try {
      JSON.parse(data.toString("utf8"));
    } catch (error) {
      failures.push(`Invalid JSON in source archive file ${name}: ${error instanceof Error ? error.message : "parse failed"}`);
    }
  }

  if (
    (name.startsWith("examples/") || name.startsWith("conformance/"))
    && (name.endsWith(".yaml") || name.endsWith(".yml"))
  ) {
    try {
      YAML.parse(data.toString("utf8"));
    } catch (error) {
      failures.push(`Invalid YAML in source archive file ${name}: ${error instanceof Error ? error.message : "parse failed"}`);
    }
  }
}

if (failures.length === 0) {
  await validateExtractedArchive(entries, archive, failures);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Source archive check passed with ${entries.filter((entry) => !entry.isDirectory).length} file(s).`);

async function validateExtractedArchive(entries, archiveBuffer, failures) {
  const cliPath = path.join(repoRoot, "dist", "cli.js");
  if (!existsSync(cliPath)) {
    failures.push("Cannot validate extracted source archive fixtures because dist/cli.js is missing. Run `npm run build` first.");
    return;
  }

  const extractRoot = await mkdtemp(path.join(tmpdir(), "aicf-source-archive-"));
  try {
    for (const entry of entries) {
      const name = normalizeEntryName(entry.name);
      if (!name) {
        continue;
      }

      const target = path.resolve(extractRoot, name);
      if (!target.startsWith(`${extractRoot}${path.sep}`) && target !== extractRoot) {
        failures.push(`Unsafe archive path: ${entry.name}`);
        continue;
      }

      if (entry.isDirectory) {
        mkdirSync(target, { recursive: true });
        continue;
      }

      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readEntryData(archiveBuffer, entry));
    }

    for (const validationPath of [
      path.join(extractRoot, "examples"),
      path.join(extractRoot, "conformance", "valid")
    ]) {
      if (existsSync(validationPath)) {
        execFileSync(process.execPath, [cliPath, "validate", validationPath], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
      }
    }
  } catch (error) {
    failures.push(`Extracted source archive fixture validation failed: ${error instanceof Error ? error.message : "validation failed"}`);
  } finally {
    rmSync(extractRoot, { force: true, recursive: true });
  }
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory.");
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    entries.push({
      compressedSize,
      isDirectory: name.endsWith("/"),
      localHeaderOffset,
      method,
      name,
      uncompressedSize
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntryData(buffer, entry) {
  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header for ${entry.name}.`);
  }

  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) {
    return compressed;
  }

  if (entry.method === 8) {
    const inflated = zlib.inflateRawSync(compressed);
    if (inflated.length !== entry.uncompressedSize) {
      throw new Error(`Unexpected uncompressed size for ${entry.name}.`);
    }
    return inflated;
  }

  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Could not find ZIP end of central directory.");
}

function normalizeEntryName(name) {
  return name.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathFailures(file) {
  const failures = [];
  const lowerFile = file.toLowerCase();
  const segments = lowerFile.split("/");
  const forbiddenSegments = new Set([
    ".git",
    "_private",
    "private",
    "local",
    ".local",
    "drafts",
    "archive",
    "archives",
    "backups",
    "scratch",
    "tmp",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".turbo",
    ".next",
    "out",
    "playwright-report",
    "test-results",
    "promptfoo-results",
    "traces",
    "logs",
    "dist-source"
  ]);
  const forbiddenExtensions = [
    ".log",
    ".tgz",
    ".zip",
    ".docx",
    ".pdf",
    ".pptx",
    ".xlsx"
  ];

  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    failures.push(`Forbidden source archive path included: ${file}`);
  }

  if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
    failures.push(`Environment file included in source archive: ${file}`);
  }

  if (forbiddenExtensions.some((extension) => lowerFile.endsWith(extension))) {
    failures.push(`Forbidden source archive artifact included: ${file}`);
  }

  if (
    lowerFile.includes("provider-payload")
    || lowerFile.includes("raw-payload")
    || lowerFile.includes("raw_provider")
    || lowerFile.includes("raw-prompt")
    || lowerFile.includes("raw_prompt")
    || lowerFile.includes("raw-trace")
    || lowerFile.includes("raw_trace")
  ) {
    failures.push(`Provider/private payload-looking source archive path included: ${file}`);
  }

  return failures;
}
