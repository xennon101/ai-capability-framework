#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  validatePublicFixtures
} from "../../dist/index.js";
import {
  createControlPlaneService,
  FileControlPlaneStore,
  routeControlPlaneRequest
} from "../../dist/control-plane/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const port = Number.parseInt(process.env.PORT ?? "4127", 10);

const seedPath = path.join(here, "fixtures", "control-plane.seed.json");
const statePath = process.env.AICF_CONTROL_PLANE_STATE
  ? path.resolve(process.env.AICF_CONTROL_PLANE_STATE)
  : path.join(repoRoot, ".aicf", "control-plane-state.json");
const seed = JSON.parse(await readFile(seedPath, "utf8"));

const loaded = await loadManifests({ path: path.join(repoRoot, "examples") });
const validation = validateManifests(loaded.manifests);
const fixtureValidation = validatePublicFixtures(loaded.fixtures);
const errors = [...loaded.errors, ...validation.errors, ...fixtureValidation.errors];
if (errors.length > 0) {
  console.error(errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  process.exit(1);
}

const registry = buildRegistry(loaded.manifests);
const store = new FileControlPlaneStore(statePath, seed);
const service = createControlPlaneService({
  conformanceProviders: ["openai", "mcp"],
  manifestRoot: "examples",
  registry,
  serverUrl: "https://aicf.example.com",
  store
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`
    );
    if (url.pathname.startsWith("/api/aicf/")) {
      const routed = await routeControlPlaneRequest({
        request: {
          body: await readJsonBody(request),
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join(",") : value
            ])
          ),
          method: request.method ?? "GET",
          path: url.pathname,
          user: {
            displayName: "Local dev operator",
            id: "local-dev-user",
            roles: ["aicf_control_plane_operator"]
          }
        },
        service
      });
      response.writeHead(routed.status, routed.headers);
      response.end(JSON.stringify(routed.body, null, 2));
      return;
    }

    const staticPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(
      here,
      "public",
      path.normalize(staticPath).replace(/^(\.\.[/\\])+/, "")
    );
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType(filePath)
    });
    response.end(content);
  } catch {
    response.writeHead(404, {
      "content-type": "text/plain"
    });
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`AICF control plane example running at http://localhost:${port}`);
  console.log(`Mutable state: ${statePath}`);
});

async function readJsonBody(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "GET")) {
    return undefined;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text);
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".json")) return "application/json";
  return "text/html";
}
