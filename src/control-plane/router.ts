import { sanitizeControlPlanePayload } from "./redaction.js";
import { ControlPlaneServiceError } from "./service.js";
import type {
  AicfControlPlaneErrorBody,
  AicfControlPlaneResponse,
  ControlPlaneCreateKillSwitchInput,
  ControlPlaneEvidenceExportInput,
  ControlPlaneLifecycleRequestBody,
  RouteControlPlaneRequestInput
} from "./types.js";

export async function routeControlPlaneRequest(
  input: RouteControlPlaneRequestInput
): Promise<AicfControlPlaneResponse> {
  try {
    return await route(input);
  } catch (error) {
    return errorResponse(error);
  }
}

async function route(input: RouteControlPlaneRequestInput): Promise<AicfControlPlaneResponse> {
  const method = input.request.method.toUpperCase();
  const segments = pathSegments(input.request.path);
  const service = input.service;

  if (!matchesPrefix(segments)) {
    return notFound("Unknown AICF control-plane API path.");
  }

  const resource = segments[2];
  const id = segments[3] ? decodeURIComponent(segments[3]) : undefined;
  const nested = segments[4];
  const action = segments[5];

  if (resource === "capabilities") {
    if (method === "GET" && !id) return ok(await service.listCapabilities());
    if (method === "GET" && id && !nested) return ok(await service.getCapability(id));
    if (method === "GET" && id && nested === "impact") return ok(await service.getCapabilityImpact(id));
    if (method === "POST" && id && nested === "lifecycle" && action === "evaluate") {
      return ok(await service.evaluateLifecycle(id, input.request.body as ControlPlaneLifecycleRequestBody));
    }
    return methodNotAllowed();
  }

  if (resource === "decisions" && method === "GET" && !id) return ok(await service.listDecisions());
  if (resource === "actions" && method === "GET" && !id) return ok(await service.listActions());
  if (resource === "approvals") {
    if (method === "GET" && !id) return ok(await service.listApprovals());
    if (method === "POST" && id && nested === "approve") return ok(await service.approveApproval(id, approvalBody(input.request.body)));
    if (method === "POST" && id && nested === "reject") return ok(await service.rejectApproval(id, approvalBody(input.request.body)));
    return methodNotAllowed();
  }

  if (resource === "controls" && nested === undefined && id === "kill-switches") {
    if (method === "GET") return ok(await service.listKillSwitches());
    if (method === "POST") return created(await service.createKillSwitch(input.request.body as ControlPlaneCreateKillSwitchInput));
    return methodNotAllowed();
  }

  if (resource === "controls" && id === "kill-switches" && nested && !action) {
    if (method === "DELETE") return ok(await service.deleteKillSwitch(decodeURIComponent(nested)));
    return methodNotAllowed();
  }

  if (resource === "evals" && id === "status" && method === "GET") return ok(await service.getEvalStatus());
  if (resource === "conformance" && id === "status" && method === "GET") return ok(await service.getConformanceStatus());
  if (resource === "evidence" && id === "export" && method === "POST") {
    return ok(await service.exportEvidence(input.request.body as ControlPlaneEvidenceExportInput));
  }

  return notFound("Unknown AICF control-plane API path.");
}

function ok(body: unknown): AicfControlPlaneResponse {
  return response(200, body);
}

function created(body: unknown): AicfControlPlaneResponse {
  return response(201, body);
}

function response(status: number, body: unknown): AicfControlPlaneResponse {
  return {
    body: sanitizeControlPlanePayload(body),
    headers: {
      "content-type": "application/json"
    },
    status
  };
}

function errorResponse(error: unknown): AicfControlPlaneResponse<AicfControlPlaneErrorBody> {
  if (error instanceof ControlPlaneServiceError) {
    return {
      body: {
        error: {
          code: error.code,
          message: error.message
        }
      },
      headers: {
        "content-type": "application/json"
      },
      status: error.code === "control_plane_not_found" ? 404 : 400
    };
  }

  return {
    body: {
      error: {
        code: "control_plane_store_error",
        message: "The control-plane request failed."
      }
    },
    headers: {
      "content-type": "application/json"
    },
    status: 500
  };
}

function methodNotAllowed(): AicfControlPlaneResponse<AicfControlPlaneErrorBody> {
  return {
    body: {
      error: {
        code: "control_plane_method_not_allowed",
        message: "The requested method is not allowed for this AICF control-plane path."
      }
    },
    headers: {
      "content-type": "application/json"
    },
    status: 405
  };
}

function notFound(message: string): AicfControlPlaneResponse<AicfControlPlaneErrorBody> {
  return {
    body: {
      error: {
        code: "control_plane_not_found",
        message
      }
    },
    headers: {
      "content-type": "application/json"
    },
    status: 404
  };
}

function pathSegments(urlPath: string): string[] {
  return urlPath
    .split("?")[0]
    ?.split("/")
    .filter(Boolean) ?? [];
}

function matchesPrefix(segments: string[]): boolean {
  return segments[0] === "api" && segments[1] === "aicf";
}

function approvalBody(body: unknown): { decidedAt?: string; reason?: string } {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    return {
      decidedAt: typeof record.decidedAt === "string" ? record.decidedAt : undefined,
      reason: typeof record.reason === "string" ? record.reason : undefined
    };
  }
  return {};
}
