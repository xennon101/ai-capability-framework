export {
  evaluateMemoryExposure,
  memoryRecordToContextSegment,
  memoryRecordToRuntimeContextItem,
  selectGovernedMemory,
  validateGovernedMemoryRecord
} from "./governance.js";

export type {
  GovernedMemoryFixture,
  GovernedMemoryRecord,
  MemoryConfidence,
  MemoryContextConversionOptions,
  MemoryExposureContext,
  MemoryExposureDecision,
  MemoryReason,
  MemoryRecordValidationResult,
  MemoryScope,
  MemorySelectionResult
} from "./types.js";
