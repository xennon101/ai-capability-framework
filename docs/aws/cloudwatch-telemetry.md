# CloudWatch Telemetry

`CloudWatchTelemetryPublisher` emits sanitized AICF trace and audit events to CloudWatch
metrics and CloudWatch Logs when caller-provided clients are configured.

```ts
import { CloudWatchTelemetryPublisher } from "ai-capability-framework/aws";

const telemetry = new CloudWatchTelemetryPublisher({
  cloudWatchClient,
  cloudWatchLogsClient,
  logGroupName: "/aws/aicf/runtime",
  logStreamName: "production",
  namespace: "AICF"
});
```

The helper publishes count metrics and metadata-mode log entries. It should not be used
to capture raw prompts, raw provider payloads, secrets, tokens, cookies, payment data,
or private diagnostics.
