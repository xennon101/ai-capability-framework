import { adapterToolDescription } from "../../adapter-common.js";
import type { AicfProviderToolDescriptor, BuildProviderToolDescriptorInput } from "./types.js";

export function buildProviderToolDescriptor(input: BuildProviderToolDescriptorInput): AicfProviderToolDescriptor {
  const capability = input.loadedCapability.manifest;
  return {
    capabilityId: capability.id,
    description: adapterToolDescription(capability),
    inputSchema: input.normalizedInputSchema,
    metadata: {
      autonomyTier: capability.autonomy_tier,
      capabilityType: capability.capability_type,
      restricted: input.binding.restricted,
      riskTier: capability.risk_tier
    },
    provider: input.binding.provider,
    providerToolName: input.binding.providerToolName
  };
}
