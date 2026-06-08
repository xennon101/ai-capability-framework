# KMS Redaction References

`KmsRedactionProvider` creates deterministic redaction references with AWS KMS
HMAC keys. It returns a redacted ref and never returns the raw input value.

```ts
import { KmsRedactionProvider } from "ai-capability-framework/aws";

const redaction = new KmsRedactionProvider({
  kmsClient,
  keyId: "alias/aicf-redaction",
  encryptionContext: { purpose: "aicf-redaction" }
});

const ref = await redaction.redact({ tenantId: "tenant_example" });
```

Use KMS key policies and IAM conditions to limit who can generate redaction
refs. Host applications remain responsible for key rotation, retention policy,
and secure handling of the original values.

