import { AicfRuntimeError, toAicfRuntimeError } from "./errors.js";
import { DefaultRedactionPolicy } from "./redaction.js";
import type {
  AicfAccountContext,
  AicfAuthPlatformAdapter,
  AicfBuiltContext,
  AicfContextBuilder,
  AicfContextBuilderInput,
  AicfContextItem,
  AicfRedactionPolicy,
  AicfRuntimeContext,
  AicfRuntimeEnvironment,
  AicfRuntimeUserInput,
  AicfRuntimeWarning,
  AicfSubjectContext,
  BuildRuntimeContextInput
} from "./types.js";

const defaultAutonomy = {
  allowExternalMessages: false,
  allowMoneyMovement: false,
  allowPermissionChanges: false,
  allowSideEffects: false,
  autonomyTier: "A1",
  maxRiskTier: "low"
} as const;

export class StaticAuthPlatformAdapter implements AicfAuthPlatformAdapter {
  private account: AicfAccountContext;
  private capabilityPermissions: Record<string, {
    allowed: boolean;
    permissions: string[];
    reason?: string;
  }>;
  private entitlements: string[];
  private subject: AicfSubjectContext;

  constructor(input: {
    account?: Partial<AicfAccountContext>;
    capabilityPermissions?: Record<string, {
      allowed: boolean;
      permissions: string[];
      reason?: string;
    }>;
    entitlements?: string[];
    subject?: Partial<AicfSubjectContext>;
  } = {}) {
    this.subject = {
      actorType: input.subject?.actorType ?? "user",
      entitlements: input.subject?.entitlements ?? input.entitlements ?? [],
      permissions: input.subject?.permissions ?? [],
      roles: input.subject?.roles ?? [],
      userId: input.subject?.userId ?? "user_test"
    };
    this.account = {
      accountId: input.account?.accountId ?? "acct_test",
      tenantId: input.account?.tenantId ?? "tenant_test",
      ...input.account
    };
    this.entitlements = input.entitlements ?? this.subject.entitlements ?? [];
    this.capabilityPermissions = input.capabilityPermissions ?? {};
  }

  async resolveSubject(): Promise<AicfSubjectContext> {
    return {
      ...this.subject,
      entitlements: this.entitlements,
      permissions: [...this.subject.permissions],
      roles: [...this.subject.roles]
    };
  }

  async resolveAccount(): Promise<AicfAccountContext> {
    return { ...this.account };
  }

  async getCapabilityPermissions(input: {
    capabilityIds: string[];
  }): Promise<Record<string, {
    allowed: boolean;
    permissions: string[];
    reason?: string;
  }>> {
    const result: Record<string, {
      allowed: boolean;
      permissions: string[];
      reason?: string;
    }> = {};

    for (const capabilityId of input.capabilityIds) {
      result[capabilityId] = this.capabilityPermissions[capabilityId] ?? {
        allowed: true,
        permissions: [...this.subject.permissions]
      };
    }

    return result;
  }

  async getEntitlements(): Promise<string[]> {
    return [...this.entitlements];
  }
}

export async function buildRuntimeContext(input: BuildRuntimeContextInput): Promise<AicfRuntimeContext> {
  try {
    const subject = await input.adapter.resolveSubject(input.subject ?? {});
    const account = await input.adapter.resolveAccount({
      ...input.account,
      subject
    });
    const entitlements = await input.adapter.getEntitlements({ account, subject });
    const runtimeContext: AicfRuntimeContext = {
      account,
      autonomy: {
        ...defaultAutonomy,
        ...input.autonomy
      },
      environment: input.environment,
      facts: input.facts ?? {},
      metadata: input.metadata ?? {},
      requestId: input.requestId ?? defaultRequestId(input.environment),
      runId: input.runId ?? defaultRunId(input.environment),
      startedAt: input.startedAt ?? new Date(0).toISOString(),
      subject: {
        ...subject,
        entitlements
      },
      workflow: input.workflow
    };

    validateRuntimeContext(runtimeContext);
    return runtimeContext;
  } catch (error) {
    throw toAicfRuntimeError(error, {
      code: "runtime_context_invalid",
      safeMessage: "Runtime context could not be resolved."
    });
  }
}

export class DefaultContextBuilder implements AicfContextBuilder {
  private hostItems: AicfContextItem[];
  private maxCharacters: number;
  private maxItems: number;
  private redactionPolicy: AicfRedactionPolicy;

  constructor(options: {
    hostItems?: AicfContextItem[];
    maxCharacters?: number;
    maxItems?: number;
    redactionPolicy?: AicfRedactionPolicy;
  } = {}) {
    this.hostItems = options.hostItems ?? [];
    this.maxCharacters = options.maxCharacters ?? 4000;
    this.maxItems = options.maxItems ?? 20;
    this.redactionPolicy = options.redactionPolicy ?? new DefaultRedactionPolicy();
  }

  async build(input: AicfContextBuilderInput): Promise<AicfBuiltContext> {
    validateRuntimeContext(input.baseContext);
    validateUserInput(input.userInput);

    const warnings: AicfRuntimeWarning[] = [];
    const rawItems = [
      userInputItem(input.userInput),
      ...workflowItems(input.baseContext),
      ...this.hostItems
    ].slice(0, this.maxItems);

    if (rawItems.length < 1 + workflowItems(input.baseContext).length + this.hostItems.length) {
      warnings.push({
        code: "context_item_limit",
        message: `Runtime context was limited to ${this.maxItems} item(s).`
      });
    }

    const items: AicfContextItem[] = [];
    const redactions = [];

    for (const item of rawItems) {
      const result = this.redactionPolicy.redact({
        item,
        runtimeContext: input.baseContext
      });
      items.push(result.item);
      redactions.push(...result.redactions);
    }

    const formatted = formatModelContext(input.baseContext, items);
    const modelContextText = formatted.length > this.maxCharacters
      ? `${formatted.slice(0, Math.max(0, this.maxCharacters - 26))}\n[context truncated]`
      : formatted;

    if (formatted.length > this.maxCharacters) {
      warnings.push({
        code: "context_character_limit",
        message: `Runtime context was limited to ${this.maxCharacters} character(s).`
      });
    }

    return {
      items,
      modelContextText,
      redactions,
      runtimeContext: input.baseContext,
      warnings
    };
  }
}

export function validateRuntimeContext(context: AicfRuntimeContext): void {
  const missing = [];

  if (!hasText(context.runId)) missing.push("runId");
  if (!hasText(context.requestId)) missing.push("requestId");
  if (!hasText(context.startedAt)) missing.push("startedAt");
  if (!hasText(context.subject?.userId)) missing.push("subject.userId");
  if (!hasText(context.account?.accountId)) missing.push("account.accountId");
  if (!hasText(context.account?.tenantId)) missing.push("account.tenantId");

  if (context.environment === "production") {
    if (!hasText(context.subject?.userId)) missing.push("production.subject.userId");
    if (!hasText(context.account?.accountId)) missing.push("production.account.accountId");
    if (!hasText(context.account?.tenantId)) missing.push("production.account.tenantId");
  }

  if (missing.length > 0) {
    throw new AicfRuntimeError({
      code: "runtime_context_invalid",
      details: { missing: [...new Set(missing)] },
      safeMessage: "Runtime context is missing required identity or request fields."
    });
  }
}

function validateUserInput(userInput: AicfRuntimeUserInput): void {
  if (!hasText(userInput.text)) {
    throw new AicfRuntimeError({
      code: "runtime_context_invalid",
      safeMessage: "Runtime user input text is required."
    });
  }

  for (const [index, attachment] of (userInput.attachments ?? []).entries()) {
    const rawAttachment = attachment as Record<string, unknown>;
    if ("bytes" in rawAttachment || "content" in rawAttachment || "data" in rawAttachment || "buffer" in rawAttachment) {
      throw new AicfRuntimeError({
        code: "runtime_context_invalid",
        details: { attachmentIndex: index },
        safeMessage: "Runtime attachments must be references, not raw file content."
      });
    }
  }
}

function userInputItem(userInput: AicfRuntimeUserInput): AicfContextItem {
  return {
    id: "user_input",
    kind: "message_summary",
    source: {
      type: "user"
    },
    text: userInput.text,
    title: "User request",
    trusted: false,
    visibleToModel: true
  };
}

function workflowItems(context: AicfRuntimeContext): AicfContextItem[] {
  if (!context.workflow) {
    return [];
  }

  return [{
    data: { ...context.workflow },
    id: "workflow_context",
    kind: "workflow",
    source: {
      type: "app"
    },
    title: "Workflow context",
    trusted: true,
    visibleToModel: true
  }];
}

function formatModelContext(context: AicfRuntimeContext, items: AicfContextItem[]): string {
  const lines = [
    "# Runtime context",
    `Environment: ${context.environment}`,
    `Tenant: ${context.account.tenantId}`,
    `Account: ${context.account.accountId}`,
    `User: ${context.subject.userId}`,
    `Autonomy tier: ${context.autonomy.autonomyTier}`,
    "",
    "# User request",
    "<untrusted_user_text>",
    items.find((item) => item.id === "user_input")?.text ?? "",
    "</untrusted_user_text>",
    "",
    "# Approved application context"
  ];

  for (const item of items.filter((candidate) => candidate.visibleToModel && candidate.id !== "user_input")) {
    lines.push(`[${item.kind}:${item.id}]`);
    if (item.title) lines.push(`Title: ${item.title}`);
    if (item.text) lines.push(item.text);
    if (item.data) lines.push(JSON.stringify(item.data));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function defaultRunId(environment: AicfRuntimeEnvironment): string {
  if (environment === "production") {
    throw new AicfRuntimeError({
      code: "runtime_context_invalid",
      safeMessage: "Production runtime context requires runId."
    });
  }

  return "run_test_0001";
}

function defaultRequestId(environment: AicfRuntimeEnvironment): string {
  if (environment === "production") {
    throw new AicfRuntimeError({
      code: "runtime_context_invalid",
      safeMessage: "Production runtime context requires requestId."
    });
  }

  return "req_test_0001";
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

