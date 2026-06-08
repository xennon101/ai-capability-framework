import { stableStringify } from "../audit/index.js";
import {
  asAwsClient,
  sanitizeAwsDetail
} from "./helpers.js";
import type {
  AwsClientLike,
  KmsRedactionProviderOptions,
  KmsRedactionRef
} from "./types.js";

export class KmsRedactionProvider {
  private client: AwsClientLike;
  private options: KmsRedactionProviderOptions;

  constructor(options: KmsRedactionProviderOptions) {
    this.options = options;
    this.client = asAwsClient(options.kmsClient, "KMS client");
  }

  async redact(value: unknown): Promise<KmsRedactionRef> {
    const createdAt = (this.options.now?.() ?? new Date()).toISOString();
    const sanitized = sanitizeAwsDetail(value);
    const message = new TextEncoder().encode(stableStringify(sanitized));
    const output = await this.client.send(await kmsCommand("GenerateMacCommand", {
      EncryptionContext: this.options.encryptionContext,
      KeyId: this.options.keyId,
      MacAlgorithm: "HMAC_SHA_256",
      Message: message
    })) as { Mac?: Uint8Array | Buffer | string };

    if (!output.Mac) {
      throw new Error("KMS GenerateMac did not return a MAC value.");
    }

    return {
      algorithm: "aws-kms-hmac-sha256",
      createdAt,
      keyId: this.options.keyId,
      ref: macToString(output.Mac)
    };
  }
}

type KmsCommandName = "GenerateMacCommand";

async function kmsCommand(commandName: KmsCommandName, input: Record<string, unknown>): Promise<unknown> {
  let module: Record<KmsCommandName, new (input: Record<string, unknown>) => unknown>;
  try {
    module = await import("@aws-sdk/client-kms") as unknown as Record<KmsCommandName, new (input: Record<string, unknown>) => unknown>;
  } catch {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-kms" is required to use ${commandName}.`);
  }
  const Command = module[commandName];
  if (typeof Command !== "function") {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-kms" did not export ${commandName}.`);
  }
  return new Command(input);
}

function macToString(mac: Uint8Array | Buffer | string): string {
  if (typeof mac === "string") {
    return mac;
  }
  return Buffer.from(mac).toString("base64url");
}
