import Ajv2020 from "ajv/dist/2020.js";
import { createToolEnvelope, runtimeErrorToEnvelopeError } from "./envelope.js";
import { writeAuditEvent } from "./audit.js";
import type {
  AicfPolicyDecision,
  AicfRuntimeToolResultEnvelope,
  AicfToolExecutionRequest,
  AicfToolExecutorOptions,
  LoadedCapabilityManifest
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

export class AicfToolExecutor {
  private options: AicfToolExecutorOptions;

  constructor(options: AicfToolExecutorOptions) {
    this.options = options;
  }

  async execute(request: AicfToolExecutionRequest): Promise<AicfRuntimeToolResultEnvelope> {
    const operation = (request as { operation?: string }).operation;
    await writeAuditEvent(this.options.auditSink, {
      capabilityId: request.capabilityId,
      operation: operation === "prepare" ? "prepare" : operation === "read" ? "read" : undefined,
      runtimeContext: request.runtimeContext,
      status: "attempted",
      type: "tool_execution"
    });

    if (operation === "commit") {
      return this.denied(request, request.capabilityId, "read", {
        reasons: [{
          code: "commit_not_model_executable",
          message: "Commit cannot be executed through the model tool executor.",
          severity: "error",
          source: "aicf"
        }],
        requiredApprovals: [],
        status: "denied"
      });
    }

    const capability = this.options.registry.capabilityById.get(request.capabilityId);
    if (!capability) {
      return this.unavailable(request, request.capabilityId, request.operation, "Capability was not found.");
    }

    const lifecycleError = lifecycleErrorFor(capability, request.operation);
    if (lifecycleError) {
      return this.denied(request, capability.manifest.id, request.operation, {
        reasons: [{
          code: "lifecycle_not_supported",
          message: lifecycleError,
          severity: "error",
          source: "aicf"
        }],
        requiredApprovals: [],
        status: "denied"
      }, capability.manifest.version);
    }

    const inputValidation = validateAgainstSchema(capability, request.args, "input");
    if (!inputValidation.valid) {
      await writeAuditEvent(this.options.auditSink, {
        capabilityId: capability.manifest.id,
        operation: request.operation,
        runtimeContext: request.runtimeContext,
        status: "failed",
        type: "tool_execution"
      });
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        errors: inputValidation.errors,
        operation: request.operation,
        requestId: request.runtimeContext.requestId,
        runId: request.runtimeContext.runId,
        status: "validation_error",
        userMessage: "The tool input was invalid."
      });
    }

    if (request.operation === "prepare") {
      const result = await this.options.actionLifecycle.prepare({
        args: request.args,
        builtContext: request.builtContext,
        capabilityId: request.capabilityId,
        idempotencyKey: request.idempotencyKey,
        runtimeContext: request.runtimeContext
      });
      await writeAuditEvent(this.options.auditSink, {
        capabilityId: capability.manifest.id,
        operation: "prepare",
        runtimeContext: request.runtimeContext,
        status: statusToAuditStatus(result.status),
        type: "tool_execution"
      });
      return result;
    }

    const handler = this.options.handlers.get(request.capabilityId);
    if (!handler?.read) {
      if (this.options.throwOnMissingHandler) {
        throw new Error(`No read handler is registered for capability "${request.capabilityId}".`);
      }

      return this.unavailable(request, capability.manifest.id, "read", "No read handler is registered.", capability.manifest.version);
    }

    const policy = await this.options.policyBroker.evaluate({
      args: request.args,
      builtContext: request.builtContext,
      capability,
      facts: factsFromRuntime(request.runtimeContext),
      operation: "select",
      runtimeContext: request.runtimeContext
    });

    if (policy.status === "denied") {
      await writeAuditEvent(this.options.auditSink, {
        capabilityId: capability.manifest.id,
        operation: "read",
        runtimeContext: request.runtimeContext,
        status: "denied",
        type: "tool_execution"
      });
      return this.denied(request, capability.manifest.id, "read", policy, capability.manifest.version);
    }

    if (policy.status === "approval_required") {
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        operation: "read",
        policy,
        requestId: request.runtimeContext.requestId,
        runId: request.runtimeContext.runId,
        status: "approval_required",
        userMessage: "Approval is required before this tool can continue."
      });
    }

    try {
      const output = await handler.read({
        args: request.args,
        builtContext: request.builtContext,
        runtimeContext: request.runtimeContext
      });
      const outputValidation = validateAgainstSchema(capability, output, "output");
      if (!outputValidation.valid) {
        await writeAuditEvent(this.options.auditSink, {
          capabilityId: capability.manifest.id,
          operation: "read",
          runtimeContext: request.runtimeContext,
          status: "failed",
          type: "tool_execution"
        });
        return createToolEnvelope({
          capabilityId: capability.manifest.id,
          capabilityVersion: capability.manifest.version,
          errors: outputValidation.errors,
          operation: "read",
          requestId: request.runtimeContext.requestId,
          runId: request.runtimeContext.runId,
          status: "failed",
          userMessage: "The tool output was invalid."
        });
      }

      await writeAuditEvent(this.options.auditSink, {
        capabilityId: capability.manifest.id,
        operation: "read",
        runtimeContext: request.runtimeContext,
        status: "succeeded",
        type: "tool_execution"
      });
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        data: output,
        operation: "read",
        policy,
        requestId: request.runtimeContext.requestId,
        runId: request.runtimeContext.runId,
        status: "success",
        userMessage: "The tool completed."
      });
    } catch (error) {
      await writeAuditEvent(this.options.auditSink, {
        capabilityId: capability.manifest.id,
        operation: "read",
        runtimeContext: request.runtimeContext,
        status: "failed",
        type: "tool_execution"
      });
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        errors: [runtimeErrorToEnvelopeError(error)],
        operation: "read",
        requestId: request.runtimeContext.requestId,
        runId: request.runtimeContext.runId,
        status: "failed",
        userMessage: "The read handler failed."
      });
    }
  }

  private unavailable(
    request: AicfToolExecutionRequest,
    capabilityId: string,
    operation: "read" | "prepare",
    message: string,
    capabilityVersion?: string
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId,
      capabilityVersion,
      errors: [{
        code: "handler_not_found",
        message
      }],
      operation,
      requestId: request.runtimeContext.requestId,
      runId: request.runtimeContext.runId,
      status: "unavailable",
      userMessage: "The capability is unavailable."
    });
  }

  private denied(
    request: AicfToolExecutionRequest,
    capabilityId: string,
    operation: "read" | "prepare",
    policy: AicfPolicyDecision,
    capabilityVersion?: string
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId,
      capabilityVersion,
      operation,
      policy,
      requestId: request.runtimeContext.requestId,
      runId: request.runtimeContext.runId,
      status: "denied",
      userMessage: "The action is not allowed."
    });
  }
}

function lifecycleErrorFor(
  capability: LoadedCapabilityManifest,
  operation: "read" | "prepare"
): string | null {
  if (operation === "prepare" && !capability.manifest.lifecycle.prepare) {
    return "Capability does not support prepare.";
  }

  if (operation === "read" && !["read_data", "retrieve_documents", "compute"].includes(capability.manifest.capability_type)) {
    return "Capability does not support read execution.";
  }

  return null;
}

function validateAgainstSchema(
  capability: LoadedCapabilityManifest,
  value: unknown,
  direction: "input" | "output"
): { errors: Array<{ code: string; message: string; path?: string }>; valid: boolean } {
  const validate = ajv.compile(direction === "input" ? capability.manifest.input_schema : capability.manifest.output_schema);
  if (validate(value)) {
    return {
      errors: [],
      valid: true
    };
  }

  return {
    errors: (validate.errors ?? []).map((error) => ({
      code: direction === "input" ? "schema_validation_failed" : "output_schema_validation_failed",
      message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`
    })),
    valid: false
  };
}

function statusToAuditStatus(status: AicfRuntimeToolResultEnvelope["status"]): "approval_required" | "denied" | "failed" | "succeeded" {
  if (status === "approval_required") return "approval_required";
  if (status === "denied" || status === "validation_error") return "denied";
  if (status === "failed" || status === "unavailable") return "failed";
  return "succeeded";
}

function factsFromRuntime(runtimeContext: { facts: Record<string, unknown> }): Record<string, boolean | { value: boolean; reason?: string }> {
  const facts: Record<string, boolean | { value: boolean; reason?: string }> = {};
  for (const [key, value] of Object.entries(runtimeContext.facts)) {
    if (typeof value === "boolean") {
      facts[key] = value;
    } else if (isRecord(value) && typeof value.value === "boolean") {
      facts[key] = {
        reason: typeof value.reason === "string" ? value.reason : undefined,
        value: value.value
      };
    }
  }

  return facts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
