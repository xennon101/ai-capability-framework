import type { AicfAwsTestingCommandRecord } from "./types.js";

export class RecordingAwsClient {
  readonly commands: AicfAwsTestingCommandRecord[] = [];
  private responses = new Map<string, unknown[]>();

  constructor(responses: Record<string, unknown[]> = {}) {
    for (const [name, values] of Object.entries(responses)) {
      this.responses.set(name, [...values]);
    }
  }

  async send(command: unknown): Promise<unknown> {
    const record = commandRecord(command);
    this.commands.push(record);
    return this.responses.get(record.name)?.shift() ?? {};
  }
}

export class FakeDynamoDbDocumentClient extends RecordingAwsClient {
  readonly items = new Map<string, Record<string, unknown>>();

  override async send(command: unknown): Promise<unknown> {
    const record = commandRecord(command);
    this.commands.push(record);

    if (record.name === "PutCommand") {
      const item = record.input.Item as Record<string, unknown>;
      const key = itemKey(item);
      if (record.input.ConditionExpression && this.items.has(key)) {
        throw new Error("ConditionalCheckFailedException");
      }
      this.items.set(key, clone(item));
      return {};
    }

    if (record.name === "QueryCommand") {
      const values = record.input.ExpressionAttributeValues as Record<string, unknown> | undefined;
      const lookup = values?.[":pk"];
      const keyName = keyNameFromCondition(String(record.input.KeyConditionExpression ?? ""));
      const items = [...this.items.values()]
        .filter((item) => item[keyName] === lookup)
        .sort((left, right) => String(left.GSI1SK ?? left.GSI2SK ?? left.SK).localeCompare(String(right.GSI1SK ?? right.GSI2SK ?? right.SK)));
      return {
        Items: typeof record.input.Limit === "number" ? items.slice(0, record.input.Limit) : items
      };
    }

    if (record.name === "UpdateCommand") {
      const key = itemKey(record.input.Key as Record<string, unknown>);
      const item = this.items.get(key);
      if (!item) {
        throw new Error("ResourceNotFoundException");
      }

      const values = record.input.ExpressionAttributeValues as Record<string, unknown>;
      if (values[":expectedState"] && item.state !== values[":expectedState"]) {
        throw new Error("ConditionalCheckFailedException");
      }
      if (values[":nextState"]) {
        item.state = values[":nextState"];
        item.updatedAt = values[":updatedAt"];
        if (isRecord(item.payload)) {
          item.payload.state = values[":nextState"];
          item.payload.updatedAt = values[":updatedAt"];
        }
      }
      if (values[":result"]) {
        item.result = clone(values[":result"]);
        item.completedAt = values[":completedAt"];
      }
      this.items.set(key, clone(item));
      return {};
    }

    if (record.name === "DeleteCommand") {
      const key = itemKey(record.input.Key as Record<string, unknown>);
      this.items.delete(key);
      return {};
    }

    return {};
  }
}

export class FakeStepFunctionsClient extends RecordingAwsClient {
  private executionCounter = 0;

  override async send(command: unknown): Promise<unknown> {
    const record = commandRecord(command);
    this.commands.push(record);
    if (record.name === "StartExecutionCommand") {
      this.executionCounter += 1;
      return {
        executionArn: `arn:aws:states:us-east-1:123456789012:execution:aicf:${this.executionCounter}`
      };
    }
    return {};
  }
}

export class FakeEventBridgeClient extends RecordingAwsClient {}

export class FakeCloudWatchClient extends RecordingAwsClient {}

export class FakeCloudWatchLogsClient extends RecordingAwsClient {}

export class FakeKmsClient extends RecordingAwsClient {
  override async send(command: unknown): Promise<unknown> {
    const record = commandRecord(command);
    this.commands.push(record);
    if (record.name === "GenerateMacCommand") {
      return {
        Mac: Buffer.from(`fake-mac:${JSON.stringify(record.input.EncryptionContext ?? {})}`)
      };
    }
    return {};
  }
}

function commandRecord(command: unknown): AicfAwsTestingCommandRecord {
  const input = isRecord(command) && isRecord(command.input) ? command.input : {};
  assertNoUndefinedValues(input);
  return {
    input: clone(input),
    name: command?.constructor?.name ?? "UnknownCommand"
  };
}

function itemKey(item: Record<string, unknown>): string {
  return `${String(item.PK)}|${String(item.SK)}`;
}

function keyNameFromCondition(condition: string): string {
  if (condition.includes("GSI2PK")) {
    return "GSI2PK";
  }
  if (condition.includes("GSI1PK")) {
    return "GSI1PK";
  }
  if (condition.includes("PK")) {
    return "PK";
  }
  return "GSI1PK";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoUndefinedValues(value: unknown, path = "$"): void {
  if (value === undefined) {
    throw new Error(`FakeDynamoDbDocumentClient received undefined command value at ${path}.`);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefinedValues(item, `${path}[${index}]`));
    return;
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertNoUndefinedValues(child, `${path}.${key}`);
    }
  }
}
