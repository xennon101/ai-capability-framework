import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { controlDecisionToPolicyReasons } from "../controls/index.js";
import { createToolEnvelope, runtimeErrorToEnvelopeError } from "./envelope.js";
import { AicfRuntimeError } from "./errors.js";
import { writeAuditEvent } from "./audit.js";
import { actionIdForPreparedAction, resultRefFromValue } from "../audit/records.js";
import type {
  AicfActionLifecycleManagerOptions,
  AicfApprovalDecision,
  AicfCommitActionInput,
  AicfCommitResult,
  AicfPolicyDecision,
  AicfPrepareActionInput,
  AicfPreparedAction,
  AicfRecordApprovalInput,
  AicfRuntimeToolResultEnvelope,
  AicfVerifyActionInput,
  LoadedCapabilityManifest
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
let preparedActionCounter = 0;
let approvalCounter = 0;

export class AicfActionLifecycleManager {
  private options: AicfActionLifecycleManagerOptions;

  constructor(options: AicfActionLifecycleManagerOptions) {
    this.options = options;
  }

  async prepare(input: AicfPrepareActionInput): Promise<AicfRuntimeToolResultEnvelope> {
    const capability = this.options.registry.capabilityById.get(input.capabilityId);
    await writeAuditEvent(this.options.auditSink, {
      capabilityId: input.capabilityId,
      operation: "prepare",
      runtimeContext: input.runtimeContext,
      status: "attempted",
      type: "action_prepare"
    });

    if (!capability) {
      return this.unavailable(input, input.capabilityId, "Capability was not found.");
    }

    if (!capability.manifest.lifecycle.prepare) {
      return this.denied(input, capability, "prepare", {
        reasons: [{
          code: "lifecycle_not_supported",
          message: "Capability does not support prepare.",
          severity: "error",
          source: "aicf"
        }],
        requiredApprovals: [],
        status: "denied"
      });
    }

    const controlsDecision = this.options.controls?.evaluate({
      capability,
      capabilityId: capability.manifest.id,
      domain: capability.manifest.domain,
      operation: "prepare",
      registry: this.options.registry,
      riskTier: capability.manifest.risk_tier,
      runtimeContext: input.runtimeContext
    });
    if (controlsDecision?.status === "denied") {
      return this.denied(input, capability, "prepare", {
        reasons: controlDecisionToPolicyReasons(controlsDecision),
        requiredApprovals: [],
        status: "denied"
      });
    }

    const handler = this.options.handlers.get(input.capabilityId);
    if (!handler?.prepare) {
      return this.unavailable(input, input.capabilityId, "No prepare handler is registered.");
    }

    const inputValidation = validateAgainstSchema(capability, input.args, "input");
    if (!inputValidation.valid) {
      return this.validationError(input, capability, "prepare", inputValidation.errors);
    }

    let policy = await this.options.policyBroker.evaluate({
      args: input.args,
      builtContext: input.builtContext,
      capability,
      facts: factsFromRuntime(input.runtimeContext),
      idempotencyKey: input.idempotencyKey,
      operation: "prepare",
      runtimeContext: input.runtimeContext
    });
    if (controlsDecision?.status === "force_approval" && policy.status === "allowed") {
      policy = {
        ...policy,
        reasons: [
          ...policy.reasons,
          ...controlDecisionToPolicyReasons(controlsDecision)
        ],
        requiredApprovals: [
          ...policy.requiredApprovals,
          {
            approvalType: "operator_review",
            reason: "runtime_control_force_approval"
          }
        ],
        status: "approval_required"
      };
    }
    const policyRecord = await writeLedger(this.options.ledger, () => this.options.ledger?.recordPolicyDecision({
      args: input.args,
      capability: capability.manifest,
      operation: "prepare",
      policyDecision: policy,
      runtimeContext: input.runtimeContext
    }));

    if (policy.status === "denied") {
      await writeAuditEvent(this.options.auditSink, {
        capabilityId: capability.manifest.id,
        details: { policyStatus: policy.status },
        operation: "prepare",
        runtimeContext: input.runtimeContext,
        status: "denied",
        type: "action_prepare"
      });
      return this.denied(input, capability, "prepare", policy);
    }

    try {
      const preview = await handler.prepare({
        args: input.args,
        builtContext: input.builtContext,
        runtimeContext: input.runtimeContext
      });
      const now = new Date().toISOString();
      const preparedActionId = nextPreparedActionId(input.capabilityId);
      const expiresAt = preview.expiresAt ?? new Date(Date.now() + 3600000).toISOString();
      const preparedAction: AicfPreparedAction = {
        accountId: input.runtimeContext.account.accountId,
        argsHash: hashArgs(input.args),
        argsRedacted: redactArgs(input.args),
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        commitCapabilityId: capability.manifest.lifecycle.commit_capability_id,
        createdAt: now,
        expiresAt,
        idempotencyKey: input.idempotencyKey,
        ledgerActionId: input.ledgerActionId,
        metadata: {
          aicf: {
            accountId: input.runtimeContext.account.accountId,
            capabilityId: capability.manifest.id,
            preparedActionId,
            requestId: input.runtimeContext.requestId,
            runId: input.runtimeContext.runId,
            subjectId: input.runtimeContext.subject.userId,
            tenantId: input.runtimeContext.account.tenantId
          }
        },
        policyDecision: policy,
        preparedActionId,
        preview,
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        state: policy.status === "approval_required" ? "approval_pending" : "prepared",
        subjectId: input.runtimeContext.subject.userId,
        tenantId: input.runtimeContext.account.tenantId,
        updatedAt: now
      };
      const data = {
        policy_decision: policy.status,
        prepared_action_id: preparedActionId,
        preview: preview.data
      };
      const outputValidation = validateAgainstSchema(capability, data, "output");
      if (!outputValidation.valid) {
        await writeAuditEvent(this.options.auditSink, {
          capabilityId: capability.manifest.id,
          operation: "prepare",
          runtimeContext: input.runtimeContext,
          status: "failed",
          type: "action_prepare"
        });
        return this.failed(input, capability, "prepare", "Prepared action output failed schema validation.", outputValidation.errors);
      }

      await this.options.preparedActionStore.create(preparedAction);
      await writeLedger(this.options.ledger, () => this.options.ledger?.recordAction({
        actionId: input.ledgerActionId,
        actionState: policy.status === "approval_required" ? "approval_required" : "prepared",
        args: input.args,
        capability: capability.manifest,
        policyDecisionId: policyRecord?.decisionId,
        preparedAction,
        preview,
        runId: input.runtimeContext.runId
      }));
      if (policy.status === "approval_required") {
        await writeLedger(this.options.ledger, () => this.options.ledger?.recordApproval({
          capabilityId: capability.manifest.id,
          preparedAction,
          requiredReasonCodes: policy.requiredApprovals.map((approval) => approval.reason),
          runtimeContext: input.runtimeContext,
          status: "pending"
        }));
      }
      await writeAuditEvent(this.options.auditSink, {
        actionState: preparedAction.state,
        capabilityId: capability.manifest.id,
        operation: "prepare",
        preparedActionId,
        runtimeContext: input.runtimeContext,
        status: policy.status === "approval_required" ? "approval_required" : "succeeded",
        type: "action_prepare"
      });

      return createToolEnvelope({
        action: {
          approvalRequired: policy.status === "approval_required",
          expiresAt,
          preparedActionId,
          state: preparedAction.state
        },
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        data,
        operation: "prepare",
        policy,
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: policy.status === "approval_required" ? "approval_required" : "prepared",
        userMessage: preview.userMessage ?? (policy.status === "approval_required"
          ? "Approval is required before this action can be committed."
          : "The action was prepared.")
      });
    } catch (error) {
      await writeAuditEvent(this.options.auditSink, {
        capabilityId: capability.manifest.id,
        operation: "prepare",
        runtimeContext: input.runtimeContext,
        status: "failed",
        type: "action_prepare"
      });
      return this.failed(input, capability, "prepare", "The prepare handler failed.", [runtimeErrorToEnvelopeError(error)]);
    }
  }

  async recordApproval(input: AicfRecordApprovalInput): Promise<AicfApprovalDecision> {
    const preparedAction = await this.options.preparedActionStore.get(input.preparedActionId);
    if (!preparedAction) {
      throw new AicfRuntimeError({
        code: "capability_not_found",
        safeMessage: "Prepared action was not found."
      });
    }

    if (isExpired(preparedAction.expiresAt)) {
      const now = new Date().toISOString();
      await this.options.preparedActionStore.updateState({
        expectedState: preparedAction.state,
        nextState: "expired",
        preparedActionId: preparedAction.preparedActionId,
        updatedAt: now
      });
      await writeAuditEvent(this.options.auditSink, {
        actionState: "expired",
        capabilityId: preparedAction.capabilityId,
        operation: "prepare",
        preparedActionId: input.preparedActionId,
        runtimeContext: input.runtimeContext,
        status: "denied",
        type: "approval_record"
      });
      throw new AicfRuntimeError({
        code: "approval_expired",
        safeMessage: "Prepared action has expired."
      });
    }

    if (!["prepared", "approval_pending"].includes(preparedAction.state)) {
      throw new AicfRuntimeError({
        code: "policy_denied",
        details: { state: preparedAction.state },
        safeMessage: "Prepared action cannot receive approval in its current state."
      });
    }

    const approval: AicfApprovalDecision = {
      approvalId: input.approvalId ?? nextApprovalId(input.preparedActionId),
      approved: input.approved,
      decidedAt: input.decidedAt ?? new Date().toISOString(),
      decidedBy: input.decidedBy ?? {
        actorId: input.runtimeContext.subject.userId,
        actorType: input.runtimeContext.subject.actorType
      },
      expiresAt: input.expiresAt,
      metadata: mergeAicfMetadata(input.metadata, {
        accountId: preparedAction.accountId,
        capabilityId: preparedAction.capabilityId,
        preparedActionId: preparedAction.preparedActionId,
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        subjectId: preparedAction.subjectId,
        tenantId: preparedAction.tenantId
      }),
      preparedActionId: input.preparedActionId,
      reason: input.reason
    };

    await this.options.approvalStore.create(approval);
    await this.options.preparedActionStore.updateState({
      expectedState: preparedAction.state,
      nextState: approval.approved ? "approved" : "rejected",
      preparedActionId: input.preparedActionId,
      updatedAt: approval.decidedAt ?? new Date().toISOString()
    });
    const approvalRecord = await writeLedger(this.options.ledger, () => this.options.ledger?.recordApproval({
      approval,
      capabilityId: preparedAction.capabilityId,
      preparedAction,
      runtimeContext: input.runtimeContext,
      status: approval.approved ? "approved" : "rejected"
    }));
    await writeLedger(this.options.ledger, () => this.options.ledger?.updateAction(
      ledgerActionIdForPreparedAction(preparedAction),
      {
        actionState: approval.approved ? "approved" : "rejected",
        approvalRecordId: approvalRecord?.approvalRecordId,
        updatedAt: approval.decidedAt ?? new Date().toISOString()
      }
    ));
    await writeAuditEvent(this.options.auditSink, {
      actionState: approval.approved ? "approved" : "rejected",
      capabilityId: preparedAction.capabilityId,
      operation: "prepare",
      preparedActionId: input.preparedActionId,
      runtimeContext: input.runtimeContext,
      status: approval.approved ? "allowed" : "denied",
      type: "approval_record"
    });

    return approval;
  }

  async commit(input: AicfCommitActionInput): Promise<AicfRuntimeToolResultEnvelope> {
    const preparedAction = await this.options.preparedActionStore.get(input.preparedActionId);
    const commitResolution = preparedAction ? this.resolveCommitCapabilityId(input, preparedAction) : {
      capabilityId: input.commitCapabilityId ?? "unknown"
    };
    const capabilityId = commitResolution.capabilityId ?? input.commitCapabilityId ?? preparedAction?.capabilityId ?? "unknown";
    const capability = this.options.registry.capabilityById.get(capabilityId);
    await writeAuditEvent(this.options.auditSink, {
      capabilityId,
      operation: "commit",
      preparedActionId: input.preparedActionId,
      runtimeContext: input.runtimeContext,
      status: "attempted",
      type: "action_commit"
    });

    if (!preparedAction) {
      return this.basicDenied(input, capabilityId, "commit", "Prepared action was not found.");
    }

    if (commitResolution.error) {
      return this.basicDenied(input, capabilityId, "commit", commitResolution.error);
    }

    if (!capability) {
      return this.basicUnavailable(input, capabilityId, "commit", "Commit capability was not found.");
    }

    if (!capability.manifest.lifecycle.commit) {
      return this.basicDenied(input, capability.manifest.id, "commit", "Capability does not support commit.");
    }

    const controlsDecision = this.options.controls?.evaluate({
      capability,
      capabilityId: capability.manifest.id,
      domain: capability.manifest.domain,
      operation: "commit",
      registry: this.options.registry,
      riskTier: capability.manifest.risk_tier,
      runtimeContext: input.runtimeContext
    });
    if (controlsDecision?.status === "denied") {
      return this.deniedCommit(input, capability, {
        reasons: controlDecisionToPolicyReasons(controlsDecision),
        requiredApprovals: [],
        status: "denied"
      });
    }

    if (isExpired(preparedAction.expiresAt)) {
      await this.options.preparedActionStore.updateState({
        expectedState: preparedAction.state,
        nextState: "expired",
        preparedActionId: preparedAction.preparedActionId,
        updatedAt: new Date().toISOString()
      });
      return this.basicDenied(input, capability.manifest.id, "commit", "Prepared action has expired.");
    }

    if (["rejected", "expired", "cancelled", "failed"].includes(preparedAction.state)) {
      return this.basicDenied(input, capability.manifest.id, "commit", `Prepared action is ${preparedAction.state}.`);
    }

    const approval = await this.resolveApproval(input, preparedAction);
    if (!approval) {
      return this.basicDenied(input, capability.manifest.id, "commit", "Commit requires approval.");
    }

    if (!approval.approved) {
      return this.basicDenied(input, capability.manifest.id, "commit", "Approval was rejected.");
    }

    if (approval.preparedActionId && approval.preparedActionId !== preparedAction.preparedActionId) {
      return this.basicDenied(input, capability.manifest.id, "commit", "Approval does not match prepared action.");
    }

    if (approval.expiresAt && isExpired(approval.expiresAt)) {
      return this.basicDenied(input, capability.manifest.id, "commit", "Approval has expired.");
    }

    const idempotencyKey = input.idempotencyKey ?? preparedAction.idempotencyKey;
    const idempotencyScope = [
      `tenant:${preparedAction.tenantId}`,
      `account:${preparedAction.accountId}`,
      `capability:${capability.manifest.id}`,
      `prepared:${preparedAction.preparedActionId}`
    ].join("|");
    if (capability.manifest.idempotency?.required && !idempotencyKey) {
      return this.basicDenied(input, capability.manifest.id, "commit", "Commit requires an idempotency key.");
    }

    if (idempotencyKey) {
      const reservation = await this.options.idempotencyStore.reserve({
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        key: idempotencyKey,
        metadata: {
          aicf: {
            accountId: preparedAction.accountId,
            capabilityId: capability.manifest.id,
            preparedActionId: preparedAction.preparedActionId,
            requestId: input.runtimeContext.requestId,
            runId: input.runtimeContext.runId,
            subjectId: preparedAction.subjectId,
            tenantId: preparedAction.tenantId
          }
        },
        scope: idempotencyScope
      });
      if (reservation.reserved) {
        await writeLedger(this.options.ledger, () => this.options.ledger?.recordIdempotency({
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          key: idempotencyKey,
          metadata: {
            capabilityId: capability.manifest.id,
            preparedActionId: preparedAction.preparedActionId
          },
          scope: idempotencyScope,
          status: "reserved"
        }));
      }
      if (!reservation.reserved) {
        if (reservation.existing) {
          await writeAuditEvent(this.options.auditSink, {
            capabilityId: capability.manifest.id,
            operation: "commit",
            preparedActionId: preparedAction.preparedActionId,
            runtimeContext: input.runtimeContext,
            status: "succeeded",
            type: "action_commit"
          });
          return createToolEnvelope({
            action: {
              committedActionId: String(reservation.existing.committedActionId ?? ""),
              preparedActionId: preparedAction.preparedActionId,
              state: "committed"
            },
            capabilityId: capability.manifest.id,
            capabilityVersion: capability.manifest.version,
            data: reservation.existing,
            operation: "commit",
            requestId: input.runtimeContext.requestId,
            runId: input.runtimeContext.runId,
            status: "committed",
            userMessage: "The action was already committed for this idempotency key."
          });
        }

        return this.basicDenied(input, capability.manifest.id, "commit", "Idempotency key is already reserved.");
      }
    }

    if (["committed", "verified"].includes(preparedAction.state)) {
      return this.basicDenied(input, capability.manifest.id, "commit", `Prepared action is ${preparedAction.state}.`);
    }

    const handler = this.options.handlers.get(capability.manifest.id);
    if (!handler?.commit) {
      return this.basicUnavailable(input, capability.manifest.id, "commit", "No commit handler is registered.");
    }

    const commitArgs = {
      approval_id: approval.approvalId,
      prepared_action_id: preparedAction.preparedActionId
    };
    const policy = await this.options.policyBroker.evaluate({
      approval,
      args: commitArgs,
      builtContext: input.builtContext,
      capability,
      facts: factsFromRuntime(input.runtimeContext),
      idempotencyKey,
      operation: "commit",
      preparedAction,
      runtimeContext: input.runtimeContext
    });
    const policyRecord = await writeLedger(this.options.ledger, () => this.options.ledger?.recordPolicyDecision({
      args: commitArgs,
      capability: capability.manifest,
      operation: "commit",
      policyDecision: policy,
      runtimeContext: input.runtimeContext
    }));

    if (policy.status !== "allowed") {
      return this.deniedCommit(input, capability, policy);
    }
    const actionId = ledgerActionIdForPreparedAction(preparedAction);
    await writeLedger(this.options.ledger, () => this.options.ledger?.updateAction(actionId, {
      actionState: "committing",
      policyDecisionId: policyRecord?.decisionId,
      updatedAt: new Date().toISOString()
    }));

    try {
      const result = await handler.commit({
        approval,
        preparedAction,
        runtimeContext: input.runtimeContext
      });

      if (result.status === "failed") {
        await this.options.preparedActionStore.updateState({
          expectedState: preparedAction.state,
          nextState: "failed",
          preparedActionId: preparedAction.preparedActionId,
          updatedAt: new Date().toISOString()
        });
        await writeAuditEvent(this.options.auditSink, {
          actionState: "failed",
          capabilityId: capability.manifest.id,
          operation: "commit",
          preparedActionId: preparedAction.preparedActionId,
          runtimeContext: input.runtimeContext,
          status: "failed",
          type: "action_commit"
        });
        await writeLedger(this.options.ledger, () => this.options.ledger?.updateAction(actionId, {
          actionState: "failed",
          resultHash: resultRefFromValue(result, "commit_result").resultHash,
          updatedAt: new Date().toISOString()
        }));
        return this.basicFailed(input, capability.manifest.id, "commit", result.userMessage ?? "Commit failed.", []);
      }

      const data = result.data ?? commitResultData(result);
      const outputValidation = validateAgainstSchema(capability, data, "output");
      if (!outputValidation.valid) {
        await this.options.preparedActionStore.updateState({
          expectedState: preparedAction.state,
          nextState: "failed",
          preparedActionId: preparedAction.preparedActionId,
          updatedAt: new Date().toISOString()
        });
        await writeAuditEvent(this.options.auditSink, {
          actionState: "failed",
          capabilityId: capability.manifest.id,
          operation: "commit",
          preparedActionId: preparedAction.preparedActionId,
          runtimeContext: input.runtimeContext,
          status: "failed",
          type: "action_commit"
        });
        await writeLedger(this.options.ledger, () => this.options.ledger?.updateAction(actionId, {
          actionState: "failed",
          resultHash: resultRefFromValue(outputValidation.errors, "validation_errors").resultHash,
          updatedAt: new Date().toISOString()
        }));
        return this.basicFailed(input, capability.manifest.id, "commit", "Commit output failed schema validation.", outputValidation.errors);
      }

      await this.options.preparedActionStore.updateState({
        expectedState: preparedAction.state,
        nextState: "committed",
        preparedActionId: preparedAction.preparedActionId,
        updatedAt: new Date().toISOString()
      });

      if (idempotencyKey) {
        await this.options.idempotencyStore.complete({
          key: idempotencyKey,
          result: {
            ...data,
            committedActionId: result.committedActionId
          },
          scope: idempotencyScope
        });
        await writeLedger(this.options.ledger, () => this.options.ledger?.recordIdempotency({
          key: idempotencyKey,
          metadata: {
            capabilityId: capability.manifest.id,
            preparedActionId: preparedAction.preparedActionId
          },
          resultRef: resultRefFromValue({
            ...data,
            committedActionId: result.committedActionId
          }, "commit_result"),
          scope: idempotencyScope,
          status: "completed"
        }));
      }
      await writeLedger(this.options.ledger, () => this.options.ledger?.updateAction(actionId, {
        actionState: "committed",
        resultHash: resultRefFromValue(data, "commit_result").resultHash,
        updatedAt: new Date().toISOString()
      }));

      await writeAuditEvent(this.options.auditSink, {
        actionState: "committed",
        capabilityId: capability.manifest.id,
        operation: "commit",
        preparedActionId: preparedAction.preparedActionId,
        runtimeContext: input.runtimeContext,
        status: "succeeded",
        type: "action_commit"
      });

      return createToolEnvelope({
        action: {
          committedActionId: result.committedActionId,
          preparedActionId: preparedAction.preparedActionId,
          state: "committed"
        },
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        data,
        operation: "commit",
        policy,
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: "committed",
        userMessage: result.userMessage ?? "The action was committed."
      });
    } catch (error) {
      await this.options.preparedActionStore.updateState({
        expectedState: preparedAction.state,
        nextState: "failed",
        preparedActionId: preparedAction.preparedActionId,
        updatedAt: new Date().toISOString()
      });
      await writeAuditEvent(this.options.auditSink, {
        actionState: "failed",
        capabilityId: capability.manifest.id,
        operation: "commit",
        preparedActionId: preparedAction.preparedActionId,
        runtimeContext: input.runtimeContext,
        status: "failed",
        type: "action_commit"
      });
      await writeLedger(this.options.ledger, () => this.options.ledger?.updateAction(actionId, {
        actionState: "failed",
        resultHash: resultRefFromValue({ error: "commit_handler_failed" }, "error").resultHash,
        updatedAt: new Date().toISOString()
      }));
      return this.basicFailed(input, capability.manifest.id, "commit", "The commit handler failed.", [runtimeErrorToEnvelopeError(error)]);
    }
  }

  async verify(input: AicfVerifyActionInput): Promise<AicfRuntimeToolResultEnvelope> {
    const capabilityId = input.committedAction.capabilityId;
    const capability = this.options.registry.capabilityById.get(capabilityId);
    await writeAuditEvent(this.options.auditSink, {
      actionState: input.committedAction.state,
      capabilityId,
      operation: "verify",
      preparedActionId: input.committedAction.preparedActionId,
      runtimeContext: input.runtimeContext,
      status: "attempted",
      type: "action_verify"
    });

    if (!capability) {
      return createToolEnvelope({
        capabilityId,
        errors: [{
          code: "capability_not_found",
          message: "Capability was not found."
        }],
        operation: "verify",
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: "unavailable",
        userMessage: "The capability is unavailable."
      });
    }

    if (capability.manifest.lifecycle.verify !== true) {
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        errors: [{
          code: "lifecycle_not_supported",
          message: "Capability does not support verify."
        }],
        operation: "verify",
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: "denied",
        userMessage: "The action cannot be verified by this capability."
      });
    }

    const controlsDecision = this.options.controls?.evaluate({
      capability,
      capabilityId: capability.manifest.id,
      domain: capability.manifest.domain,
      operation: "verify",
      registry: this.options.registry,
      riskTier: capability.manifest.risk_tier,
      runtimeContext: input.runtimeContext
    });
    if (controlsDecision?.status === "denied") {
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        operation: "verify",
        policy: {
          reasons: controlDecisionToPolicyReasons(controlsDecision),
          requiredApprovals: [],
          status: "denied"
        },
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: "denied",
        userMessage: "The action is not allowed."
      });
    }

    const handler = this.options.handlers.get(capability.manifest.id);
    if (!handler?.verify) {
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        errors: [{
          code: "handler_not_found",
          message: "No verify handler is registered."
        }],
        operation: "verify",
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: "unavailable",
        userMessage: "The capability is unavailable."
      });
    }

    try {
      const result = await handler.verify({
        committedAction: input.committedAction,
        runtimeContext: input.runtimeContext
      });

      if (result.status === "not_supported") {
        return createToolEnvelope({
          capabilityId: capability.manifest.id,
          capabilityVersion: capability.manifest.version,
          errors: [{
            code: "lifecycle_not_supported",
            message: "Verify is not supported."
          }],
          operation: "verify",
          requestId: input.runtimeContext.requestId,
          runId: input.runtimeContext.runId,
          status: "unavailable",
          userMessage: "The action cannot be verified."
        });
      }

      if (result.status === "failed") {
        await writeAuditEvent(this.options.auditSink, {
          actionState: "failed",
          capabilityId: capability.manifest.id,
          operation: "verify",
          preparedActionId: input.committedAction.preparedActionId,
          runtimeContext: input.runtimeContext,
          status: "failed",
          type: "action_verify"
        });
        return createToolEnvelope({
          action: {
            committedActionId: input.committedAction.committedActionId,
            preparedActionId: input.committedAction.preparedActionId,
            state: "failed"
          },
          capabilityId: capability.manifest.id,
          capabilityVersion: capability.manifest.version,
          data: result.data,
          errors: [{
            code: "handler_failed",
            message: result.message ?? "The action could not be verified."
          }],
          operation: "verify",
          requestId: input.runtimeContext.requestId,
          runId: input.runtimeContext.runId,
          status: "failed",
          userMessage: result.message ?? "The action could not be verified."
        });
      }

      await writeAuditEvent(this.options.auditSink, {
        actionState: "verified",
        capabilityId: capability.manifest.id,
        operation: "verify",
        preparedActionId: input.committedAction.preparedActionId,
        runtimeContext: input.runtimeContext,
        status: "succeeded",
        type: "action_verify"
      });
      return createToolEnvelope({
        action: {
          committedActionId: input.committedAction.committedActionId,
          preparedActionId: input.committedAction.preparedActionId,
          state: "verified"
        },
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        data: result.data,
        operation: "verify",
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: "verified",
        userMessage: result.message ?? "The action was verified."
      });
    } catch (error) {
      await writeAuditEvent(this.options.auditSink, {
        actionState: "failed",
        capabilityId: capability.manifest.id,
        operation: "verify",
        preparedActionId: input.committedAction.preparedActionId,
        runtimeContext: input.runtimeContext,
        status: "failed",
        type: "action_verify"
      });
      return createToolEnvelope({
        capabilityId: capability.manifest.id,
        capabilityVersion: capability.manifest.version,
        errors: [runtimeErrorToEnvelopeError(error)],
        operation: "verify",
        requestId: input.runtimeContext.requestId,
        runId: input.runtimeContext.runId,
        status: "failed",
        userMessage: "The verify handler failed."
      });
    }
  }

  private resolveCommitCapabilityId(
    input: AicfCommitActionInput,
    preparedAction: AicfPreparedAction
  ): { capabilityId?: string; error?: string } {
    const requestedCommitCapabilityId = input.commitCapabilityId;
    const linkedCommitCapabilityId = preparedAction.commitCapabilityId;

    if (requestedCommitCapabilityId && linkedCommitCapabilityId && requestedCommitCapabilityId !== linkedCommitCapabilityId) {
      return {
        capabilityId: requestedCommitCapabilityId,
        error: "Prepared action is not linked to the requested commit capability."
      };
    }

    if (requestedCommitCapabilityId && requestedCommitCapabilityId !== preparedAction.capabilityId && requestedCommitCapabilityId !== linkedCommitCapabilityId) {
      return {
        capabilityId: requestedCommitCapabilityId,
        error: "Prepared action is not linked to the requested commit capability."
      };
    }

    if (!requestedCommitCapabilityId && linkedCommitCapabilityId) {
      return { capabilityId: linkedCommitCapabilityId };
    }

    const capabilityId = requestedCommitCapabilityId ?? preparedAction.capabilityId;
    if (capabilityId !== preparedAction.capabilityId && capabilityId !== linkedCommitCapabilityId) {
      return {
        capabilityId,
        error: "Prepared action does not declare a matching commit capability."
      };
    }

    return { capabilityId };
  }

  private async resolveApproval(
    input: AicfCommitActionInput,
    preparedAction: AicfPreparedAction
  ): Promise<AicfApprovalDecision | undefined> {
    if (input.approval) {
      return input.approval;
    }

    if (input.approvalId) {
      return this.options.approvalStore.get(input.approvalId);
    }

    const approvals = await this.options.approvalStore.getForPreparedAction(preparedAction.preparedActionId);
    return approvals.find((approval) => approval.approved);
  }

  private unavailable(input: AicfPrepareActionInput, capabilityId: string, message: string): AicfRuntimeToolResultEnvelope {
    return this.basicUnavailable(input, capabilityId, "prepare", message);
  }

  private validationError(
    input: AicfPrepareActionInput,
    capability: LoadedCapabilityManifest,
    operation: "prepare",
    errors: Array<{ code: string; message: string; path?: string }>
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId: capability.manifest.id,
      capabilityVersion: capability.manifest.version,
      errors,
      operation,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "validation_error",
      userMessage: "The tool input was invalid."
    });
  }

  private denied(
    input: AicfPrepareActionInput,
    capability: LoadedCapabilityManifest,
    operation: "prepare",
    policy: AicfPolicyDecision
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId: capability.manifest.id,
      capabilityVersion: capability.manifest.version,
      operation,
      policy,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "denied",
      userMessage: "The action is not allowed."
    });
  }

  private failed(
    input: AicfPrepareActionInput,
    capability: LoadedCapabilityManifest,
    operation: "prepare",
    message: string,
    errors: Array<{ code: string; message: string; path?: string }>
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId: capability.manifest.id,
      capabilityVersion: capability.manifest.version,
      errors,
      operation,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "failed",
      userMessage: message
    });
  }

  private deniedCommit(
    input: AicfCommitActionInput,
    capability: LoadedCapabilityManifest,
    policy: AicfPolicyDecision
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId: capability.manifest.id,
      capabilityVersion: capability.manifest.version,
      operation: "commit",
      policy,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "denied",
      userMessage: "The action is not allowed."
    });
  }

  private basicUnavailable(
    input: AicfPrepareActionInput | AicfCommitActionInput,
    capabilityId: string,
    operation: "prepare" | "commit",
    message: string
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId,
      errors: [{
        code: "handler_not_found",
        message
      }],
      operation,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "unavailable",
      userMessage: "The capability is unavailable."
    });
  }

  private basicDenied(
    input: AicfCommitActionInput,
    capabilityId: string,
    operation: "commit",
    message: string
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId,
      errors: [{
        code: "policy_denied",
        message
      }],
      operation,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "denied",
      userMessage: message
    });
  }

  private basicFailed(
    input: AicfCommitActionInput,
    capabilityId: string,
    operation: "commit",
    message: string,
    errors: Array<{ code: string; message: string; path?: string }>
  ): AicfRuntimeToolResultEnvelope {
    return createToolEnvelope({
      capabilityId,
      errors,
      operation,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "failed",
      userMessage: message
    });
  }
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

function nextPreparedActionId(capabilityId: string): string {
  preparedActionCounter += 1;
  return `prepared_${capabilityId.replace(/[^a-zA-Z0-9]+/g, "_")}_${preparedActionCounter}`;
}

function nextApprovalId(preparedActionId: string): string {
  approvalCounter += 1;
  return `approval_${preparedActionId.replace(/[^a-zA-Z0-9]+/g, "_")}_${approvalCounter}`;
}

function hashArgs(args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(sortValue(args))).digest("hex");
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (isRecord(value)) {
      result[key] = redactArgs(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isSensitiveKey(key: string): boolean {
  return /password|token|secret|api_?key|authorization|cookie|session|card_?number|cvv|private_?key/i.test(key);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue(child)]));
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

function mergeAicfMetadata(
  metadata: Record<string, unknown> | undefined,
  aicf: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    aicf: {
      ...(isRecord(metadata?.aicf) ? metadata.aicf : {}),
      ...aicf
    }
  };
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

function commitResultData(result: AicfCommitResult): Record<string, unknown> {
  return {
    committedActionId: result.committedActionId,
    status: result.status
  };
}

function ledgerActionIdForPreparedAction(preparedAction: AicfPreparedAction): string {
  return preparedAction.ledgerActionId ?? actionIdForPreparedAction(preparedAction.preparedActionId);
}

async function writeLedger<T>(
  ledger: unknown,
  operation: () => Promise<T | undefined> | T | undefined
): Promise<T | undefined> {
  if (!ledger) {
    return undefined;
  }

  try {
    return await operation();
  } catch {
    return undefined;
  }
}
