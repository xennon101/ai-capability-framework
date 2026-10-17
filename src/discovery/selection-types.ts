import type { JsonObject } from "../types.js";
import type { DiscoveryBudgetScope } from "./budget.js";
import type { CapabilityDiscoveryResult, CapabilitySelectionRequest, SelectionLimits, SelectionModelClient } from "./types.js";

export interface CapabilitySelectRequest {
  results: readonly CapabilityDiscoveryResult[];
  client: SelectionModelClient;
  budget?: DiscoveryBudgetScope;
  providerRun?: import("../runtime/provider-types.js").AicfProviderRun;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextByQueryId?: Readonly<Record<string, JsonObject>>;
  limits?: Partial<Pick<SelectionLimits, "maxTasks" | "maxInputCharacters" | "maxAttempts">>;
  maxEstimatedCostPerCall?: number;
  estimateCost?: CapabilitySelectionRequest["estimateCost"];
  signal?: AbortSignal;
  deadlineAt?: number;
}
