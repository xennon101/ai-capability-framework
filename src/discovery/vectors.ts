export function validVector(vector: unknown, dimension: number): vector is readonly number[] {
  if (!Array.isArray(vector) || Object.getPrototypeOf(vector) !== Array.prototype || vector.length !== dimension || dimension < 1
    || Reflect.ownKeys(vector).length !== dimension + 1) return false;
  let nonzero = false;
  for (let index = 0; index < dimension; index++) {
    const property = Object.getOwnPropertyDescriptor(vector, String(index));
    if (!property || !property.enumerable || !("value" in property) || typeof property.value !== "number" || !Number.isFinite(property.value)) return false;
    nonzero ||= property.value !== 0;
  }
  return nonzero;
}

export function validVectorBatch(value: unknown, count: number, dimension: number): value is readonly (readonly number[])[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length !== count || Reflect.ownKeys(value).length !== count + 1) return false;
  for (let index = 0; index < count; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !("value" in property) || !validVector(property.value, dimension)) return false;
  }
  return true;
}

/** Scale before squaring, avoiding overflow/underflow even for finite extreme components. */
export function semanticSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || !validVector(left, left.length) || !validVector(right, right.length)) {
    throw new Error("Incompatible vectors.");
  }
  let leftScale = 0, rightScale = 0;
  for (let index = 0; index < left.length; index++) {
    leftScale = Math.max(leftScale, Math.abs(left[index]!));
    rightScale = Math.max(rightScale, Math.abs(right[index]!));
  }
  let dot = 0, leftSquare = 0, rightSquare = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]! / leftScale, b = right[index]! / rightScale;
    dot += a * b; leftSquare += a * a; rightSquare += b * b;
  }
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftSquare) / Math.sqrt(rightSquare)));
}
