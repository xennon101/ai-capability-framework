import type { ContextSegment, SourceRef, TaintMark, TrustLabel } from "./types.js";

export function markTainted<T>(
  segment: ContextSegment<T>,
  input: {
    createdAt?: string;
    reason?: string;
    sourceRef?: SourceRef;
    trust?: TrustLabel;
  } = {}
): ContextSegment<T> {
  const mark: TaintMark = {
    createdAt: input.createdAt,
    reason: input.reason ?? "Segment content is not trusted for tool input until validated.",
    sourceRef: input.sourceRef ?? segment.sourceRef,
    trust: input.trust ?? segment.trust
  };
  return {
    ...clone(segment),
    instructionsAllowed: false,
    taint: mergeTaint(segment.taint ?? [], [mark])
  };
}

export function mergeTaint(left: TaintMark[] = [], right: TaintMark[] = []): TaintMark[] {
  const seen = new Set<string>();
  const merged = [];
  for (const mark of [...left, ...right]) {
    const key = JSON.stringify([
      mark.trust,
      mark.reason,
      mark.sourceRef?.sourceId,
      mark.sourceRef?.sourceType
    ]);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(clone(mark));
    }
  }
  return merged;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
