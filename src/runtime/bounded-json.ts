
/** Bounds strict JSON while traversing, before allocating a complete serialization or clone. */
export function boundedJsonSnapshot(value: unknown, maxBytes: number): unknown {
  let bytes = 0;
  const ancestors = new Set<object>();
  const add = (text: string) => {
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) throw invalid();
    return text;
  };
  const walk = (entry: unknown, depth: number): string => {
    if (depth > 32) throw invalid();
    if (entry === null || typeof entry === "boolean" || typeof entry === "number" && Number.isFinite(entry)) {
      return add(JSON.stringify(entry));
    }
    if (typeof entry === "string") {
      if (entry.length > maxBytes) throw invalid();
      return add(JSON.stringify(entry));
    }
    if (typeof entry !== "object" || !entry || ancestors.has(entry) || Object.getOwnPropertySymbols(entry).length) throw invalid();
    const array = Array.isArray(entry);
    if (array ? entry.length > maxBytes : ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) throw invalid();
    ancestors.add(entry);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      const keys = Object.keys(descriptors);
      if (keys.length > maxBytes) throw invalid();
      if (array) {
        if (keys.length !== entry.length + 1) throw invalid();
        const pieces = [add("[")];
        for (let index = 0; index < entry.length; index++) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw invalid();
          if (index) pieces.push(add(","));
          pieces.push(walk(descriptor.value, depth + 1));
        }
        pieces.push(add("]"));
        return pieces.join("");
      }
      const pieces = [add("{")];
      for (const [index, key] of keys.sort().entries()) {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw invalid();
        if (index) pieces.push(add(","));
        pieces.push(add(JSON.stringify(key)), add(":"), walk(descriptor.value, depth + 1));
      }
      pieces.push(add("}"));
      return pieces.join("");
    } finally { ancestors.delete(entry); }
  };
  return JSON.parse(walk(value, 0));
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function invalid(): Error { return new Error("Bounded finite JSON without accessors or cycles is required."); }
