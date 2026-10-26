import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { KMSClient } from "@aws-sdk/client-kms";
import { SFNClient } from "@aws-sdk/client-sfn";
import { CloudWatchTelemetryPublisher, DynamoDbAuditSink, EventBridgeRuntimeEventPublisher, KmsRedactionProvider, StepFunctionsApprovalAdapter } from "ai-capability-framework/aws";

export async function verifyAwsSdkConsumer() {
  const requests = [], clients = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected network access in SDK fixture."); };
  const config = label => ({ region: "us-east-1", credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" }, maxAttempts: 1,
    requestHandler: { handle: async request => {
      const contentType = request.headers["content-type"] ?? "", body = request.body;
      requests.push({ label, method: request.method, path: request.path, headers: request.headers, body });
      assert.equal(request.method, "POST");
      const cbor = contentType.includes("cbor"), xml = contentType.includes("x-www-form-urlencoded");
      const json = label === "kms" ? { Mac: Buffer.from("synthetic").toString("base64") } : {};
      return { response: { statusCode: 200, headers: { "content-type": cbor ? "application/cbor" : xml ? "text/xml" : "application/x-amz-json-1.1" },
        body: cbor ? new Uint8Array([0xa0]) : new TextEncoder().encode(xml ? '<PutMetricDataResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/"><ResponseMetadata><RequestId>synthetic</RequestId></ResponseMetadata></PutMetricDataResponse>' : JSON.stringify(json)) } };
    } } });
  const make = (Constructor, label) => { const client = new Constructor(config(label)); clients.push(client); return client; };
  try {
    const event = { eventId: "audit_synthetic", createdAt: "2026-01-01T00:00:00.000Z", type: "tool_execution", status: "success", requestId: "request_synthetic", runId: "run_synthetic", capabilityId: "support.ticket.get", operation: "read" };
    await new CloudWatchTelemetryPublisher({ cloudWatchClient: make(CloudWatchClient, "cloudwatch"), cloudWatchLogsClient: make(CloudWatchLogsClient, "logs"), logGroupName: "synthetic", logStreamName: "synthetic" }).publish(event);
    const dynamo = make(DynamoDBClient, "dynamodb"), document = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });
    await new DynamoDbAuditSink({ documentClient: document, tableName: "synthetic", defaultAccountId: "account_synthetic", defaultTenantId: "tenant_synthetic" }).write(event);
    await new EventBridgeRuntimeEventPublisher({ eventBridgeClient: make(EventBridgeClient, "eventbridge"), eventBusName: "synthetic" }).publish(event);
    const mac = await new KmsRedactionProvider({ kmsClient: make(KMSClient, "kms"), keyId: "synthetic", now: () => new Date("2026-01-01T00:00:00.000Z") }).redact({ value: "synthetic" });
    assert.equal(mac.algorithm, "aws-kms-hmac-sha256");
    assert.equal(mac.ref, Buffer.from("synthetic").toString("base64url"));
    await new StepFunctionsApprovalAdapter({ sfnClient: make(SFNClient, "sfn"), stateMachineArn: "synthetic" }).heartbeatApprovalTask({ taskToken: "synthetic" });
    assert.deepEqual(requests.map(r => r.label).sort(), ["cloudwatch", "dynamodb", "eventbridge", "kms", "logs", "sfn"]);
    for (const request of requests) assert(request.headers.authorization, "The actual SDK must sign the serialized request.");
    const stored = requests.find(r => r.label === "dynamodb");
    const storedBody = typeof stored.body === "string" ? stored.body : new TextDecoder().decode(stored.body);
    assert.match(storedBody, /"TableName":"synthetic"/u);
    assert.match(storedBody, /"S":"run_synthetic"/u);
    return { packages: 7, serializedRequests: requests.length, transport: "injected", networkAttempts: 0 };
  } finally { for (const client of clients) client.destroy(); globalThis.fetch = originalFetch; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyAwsSdkConsumer()));
